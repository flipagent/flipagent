/**
 * `/v1/agent/*` (preview) — chat with a flipagent-aware agent.
 *
 * Stateful threads ride on OpenAI's Responses API:
 *   - first turn  → set `instructions` + `input`, persist `response.id`
 *   - next turns  → pass `previous_response_id` so OpenAI keeps history
 *                   server-side; only the new user message goes on the wire
 *
 * User-stated rules / preferences live in `agent_rules` and are folded
 * into `instructions` every turn — that way an updated rule kicks in
 * immediately without resetting the thread.
 *
 * Tools come from `flipagent-mcp` via OpenAI's native MCP integration —
 * we hand the model an `mcp` tool entry pointing at our own `/mcp`
 * endpoint with the user's api key as the bearer header. New tool =
 * one file in `packages/mcp/src/tools/`; both the standalone MCP binary
 * (Claude Desktop) and the agent see it automatically. Tool use is
 * gated on `MCP_PUBLIC_URL` being set + the user's key having a
 * decryptable plaintext (issued after the ciphertext column existed);
 * without those the agent still chats, just without tools.
 *
 * Cost: gpt-5.5 is $5 / 1M input, $30 / 1M output as of 2026-04-24.
 * We snapshot tokens + a rounded `cost_cents` per run; sub-cent runs
 * round to 0 (recompute precisely from tokens when it matters).
 */

import type { Config as McpConfig } from "flipagent-mcp/config";
import { selectTools, type Tool as McpTool } from "flipagent-mcp/tools";
import { and, desc, eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import { decryptKeyPlaintext, isKeyRevealConfigured } from "../../auth/key-cipher.js";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import {
	type AgentRuleRow,
	type AgentRunRow,
	type AgentSessionRow,
	type ApiKey,
	agentRules,
	agentRuns,
	agentSessions,
} from "../../db/schema.js";

export class AgentNotConfiguredError extends Error {
	readonly code = "agent_not_configured" as const;
	constructor() {
		super("OPENAI_API_KEY is not set; /v1/agent/* is disabled");
		this.name = "AgentNotConfiguredError";
	}
}

export class AgentError extends Error {
	readonly code: string;
	readonly status: number;
	constructor(code: string, message: string, status = 400) {
		super(message);
		this.name = "AgentError";
		this.code = code;
		this.status = status;
	}
}

export interface AgentContext {
	/** Full validated api-key row. Service reads `id`, `userId`, and (for
	 *  chat) `keyCiphertext` to decrypt the bearer token forwarded to
	 *  OpenAI's MCP integration. */
	apiKey: ApiKey;
}

/**
 * Pricing for `AGENT_OPENAI_MODEL`. Updated 2026-04-24 launch pricing
 * for the agent-positioned flagship; override only when OpenAI shifts
 * the meter. For models we don't recognize we charge 0 (run still
 * persists, but cost is unknown — the token columns stay truthful).
 */
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
	"gpt-5.5": { input: 5, output: 30 },
	"gpt-5.5-pro": { input: 30, output: 180 },
	"gpt-5.4": { input: 2, output: 10 },
	"gpt-5.4-mini": { input: 0.25, output: 2 },
};

function costCentsFor(model: string, tokensIn: number, tokensOut: number): number {
	const tier = MODEL_PRICING_PER_1M[model];
	if (!tier) return 0;
	const dollars = (tokensIn * tier.input + tokensOut * tier.output) / 1_000_000;
	return Math.round(dollars * 100);
}

/**
 * Build the system instructions sent to OpenAI on every turn. Updated
 * rules take effect on the very next message — no thread reset needed.
 */
function buildInstructions(rules: AgentRuleRow[], mcpEnabled: boolean): string {
	const today = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		"You are flipagent's reseller agent — you help users run an eBay reselling business.",
		"You can answer questions and explain decisions about sourcing, listing, pricing, and fulfillment.",
	];
	if (mcpEnabled) {
		lines.push(
			"Live data: you have the full `flipagent` MCP toolset wired up. Call `flipagent_get_capabilities` first when the user is new — it tells you which surfaces (eBay OAuth, extension, forwarder) are ready. Use specific tools (search_items, get_item, evaluate_item, list_listings, list_sales, list_payouts, etc.) for fresh data; don't fabricate numbers.",
			"Do NOT narrate while tool calls are in flight. The host shows the user a live status indicator (\"Searching listings…\", \"Evaluating…\") for every tool call, plus the result UI inline — narration on top is noise. Stay silent until you have results, then write ONE concise reply summarizing what landed. No \"Let me check…\", no \"I'll look that up\", no announcing tools by name.",
			"Write tools (buy, bid, list, end-listing, ship, cancel, send-message, leave-feedback, respond-to-dispute/offer, register/revoke webhook, opt-in/out program, dispatch package) all work — execute them when the user gives an explicit instruction. For irreversible or buyer/seller-visible actions, echo the key parameters back in one line BEFORE calling the tool (\"Placing a $42 bid on item 12345…\") so the user can interrupt. If the user's instruction is ambiguous or you'd be guessing at amounts/recipients, ask one clarifying question first.",
		);
	} else {
		lines.push(
			"Tool use is not configured on this instance. If a question needs live data (sales, listings, inventory), say so and point the user at the dashboard.",
		);
	}
	lines.push(
		"Be concise. Default to a few sentences; expand only when the user asks for detail.",
		`Today's date: ${today}.`,
	);
	if (rules.length > 0) {
		lines.push("", "User-stated rules and preferences:");
		for (const r of rules) {
			lines.push(`- [${r.kind}] ${r.content}`);
		}
	}
	return lines.join("\n");
}

/**
 * Build the OpenAI function-tools array + per-request MCP config the
 * agent uses to dispatch tools in-process.
 *
 * Why not OpenAI's native MCP integration? The Responses API surfaces
 * MCP `mcp_call.output` items as bare strings (only `content[0].text`),
 * stripping `_meta` and `structuredContent`. That breaks the inline-UI
 * round-trip we need for MCP Apps rendering. By dispatching tools
 * ourselves, the full MCP CallTool result (incl. `_meta.ui.resourceUri`
 * + `structuredContent`) flows back unchanged, and the standalone
 * `/mcp` HTTP endpoint stays available for external clients (Claude
 * Desktop, etc.) that *do* receive the full payload.
 *
 * Bails (returns null) when:
 *   - the api key has no stored ciphertext (legacy keys)
 *   - the reveal helper isn't configured (no KEYS_ENCRYPTION_KEY in prod)
 *
 * Bail = chat keeps working, just without tool access.
 */
interface AgentToolBundle {
	tools: McpTool[];
	openaiTools: Array<{
		type: "function";
		name: string;
		description: string;
		parameters: Record<string, unknown>;
		strict: boolean;
	}>;
	mcpConfig: McpConfig;
}

function buildAgentTools(apiKey: ApiKey): AgentToolBundle | null {
	if (!isKeyRevealConfigured()) return null;
	if (!apiKey.keyCiphertext) return null;
	let plaintext: string;
	try {
		plaintext = decryptKeyPlaintext(apiKey.keyCiphertext);
	} catch {
		return null;
	}
	// Full catalog — agent has read + write parity with the MCP server.
	// Mutation guardrails live in the model instructions (echo-before-act
	// for irreversible actions); upstream errors (eBay scopes, missing
	// bridge, etc.) surface back to the user verbatim.
	const tools = selectTools(["*"]);
	const openaiTools = tools.map((t) => ({
		type: "function" as const,
		name: t.name,
		description: t.description.length > 1024 ? `${t.description.slice(0, 1020)}…` : t.description,
		// Tool inputSchemas are TypeBox schemas — they serialize cleanly to
		// JSON Schema, which is what OpenAI's function tool expects.
		parameters: (t.inputSchema as unknown as Record<string, unknown>) ?? {
			type: "object",
			properties: {},
		},
		strict: false,
	}));
	const mcpConfig: McpConfig = {
		flipagentBaseUrl: `http://127.0.0.1:${config.PORT}`,
		authToken: plaintext,
		mock: false,
		userAgent: "flipagent-agent/0.0.1",
		enabledToolsets: ["*"],
	};
	return { tools, openaiTools, mcpConfig };
}

function deriveTitle(message: string): string {
	const trimmed = message.trim().replace(/\s+/g, " ");
	return trimmed.length <= 60 ? trimmed : `${trimmed.slice(0, 57)}…`;
}

function rowToSession(row: AgentSessionRow): {
	id: string;
	title?: string;
	pinnedAt?: string;
	createdAt: string;
	lastActiveAt: string;
} {
	return {
		id: row.id,
		...(row.title ? { title: row.title } : {}),
		...(row.pinnedAt ? { pinnedAt: row.pinnedAt.toISOString() } : {}),
		createdAt: row.createdAt.toISOString(),
		lastActiveAt: row.lastActiveAt.toISOString(),
	};
}

function rowToRule(row: AgentRuleRow): {
	id: string;
	kind: "rule" | "preference" | "note";
	content: string;
	createdAt: string;
} {
	return {
		id: row.id,
		kind: row.kind as "rule" | "preference" | "note",
		content: row.content,
		createdAt: row.createdAt.toISOString(),
	};
}

function rowToRun(row: AgentRunRow) {
	const ui = row.uiResourceUri
		? {
				resourceUri: row.uiResourceUri,
				...(row.uiProps && typeof row.uiProps === "object"
					? { props: row.uiProps as Record<string, unknown> }
					: {}),
			}
		: null;
	return {
		id: row.id,
		...(row.sessionId ? { sessionId: row.sessionId } : {}),
		triggerKind: row.triggerKind as "chat" | "cron" | "webhook",
		...(row.model ? { model: row.model } : {}),
		...(row.userMessage ? { userMessage: row.userMessage } : {}),
		...(row.reply ? { reply: row.reply } : {}),
		tokensIn: row.tokensIn,
		tokensOut: row.tokensOut,
		costCents: row.costCents,
		...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
		...(ui ? { ui } : {}),
		startedAt: row.startedAt.toISOString(),
		...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
	};
}

/* ---------------------------- chat ---------------------------- */

interface AgentChatAttachment {
	kind: "image" | "file";
	dataUrl: string;
	mimeType?: string;
	name?: string;
}

/**
 * Per-attachment hard cap on the data URL length. Each base64 character
 * encodes ~0.75 bytes, so 12MB of base64 is roughly 9MB of binary —
 * comfortably under OpenAI's 20MB image ceiling and our request body
 * limit. Bigger files are rejected at the route boundary; we re-check
 * here so service callers get the same guard.
 */
const ATTACHMENT_DATA_URL_MAX_CHARS = 12 * 1024 * 1024;

function buildResponsesInput(
	message: string,
	attachments: AgentChatAttachment[],
): string | Array<{ role: "user"; content: Array<Record<string, unknown>> }> {
	if (attachments.length === 0) return message;
	const content: Array<Record<string, unknown>> = [];
	if (message.length > 0) content.push({ type: "input_text", text: message });
	for (const a of attachments) {
		if (a.kind === "image") {
			content.push({ type: "input_image", image_url: a.dataUrl });
		} else {
			content.push({
				type: "input_file",
				...(a.name ? { filename: a.name } : {}),
				file_data: a.dataUrl,
			});
		}
	}
	return [{ role: "user", content }];
}

function describeAttachmentsForLog(attachments: AgentChatAttachment[]): string {
	if (attachments.length === 0) return "";
	const parts = attachments.map((a) => `[${a.kind}${a.name ? `: ${a.name}` : ""}]`);
	return ` ${parts.join(" ")}`;
}

/**
 * Structured user-action injected into the chat input. The chat host
 * translates inline-UI postMessage events into one of these so the
 * model treats them as ordinary user input on the next turn.
 */
interface AgentChatUserAction {
	type: "tool" | "prompt";
	name?: string;
	args?: Record<string, unknown>;
	text?: string;
}

function userActionAsPrompt(action: AgentChatUserAction): string {
	if (action.type === "prompt") return action.text ?? "";
	const args = action.args ? JSON.stringify(action.args) : "{}";
	return `[ui-action] User clicked an inline UI control. Call the \`${action.name}\` tool with arguments ${args}, then summarize the result for the user.`;
}

/**
 * UI hint extracted from a Responses-API `mcp_call` output item. We
 * prefer the LAST mcp_call's metadata so multi-tool turns surface the
 * most recent UI surface (e.g., search → evaluate → renders evaluate).
 */
interface ExtractedUiHint {
	resourceUri: string;
	props?: Record<string, unknown>;
	mimeType?: string;
}

/**
 * If a tool's raw return is an MCP CallTool shape (carrying
 * `_meta.ui.resourceUri`), pull the UI hint out of it. Returns null
 * for plain-data returns.
 */
function uiHintFromToolResult(result: unknown): ExtractedUiHint | null {
	if (!result || typeof result !== "object") return null;
	const r = result as { content?: unknown; structuredContent?: unknown; _meta?: Record<string, unknown> };
	const meta = r._meta && typeof r._meta === "object" ? r._meta : null;
	if (!meta) return null;
	const uri =
		(typeof meta["ui.resourceUri"] === "string" ? (meta["ui.resourceUri"] as string) : null) ??
		(typeof meta["openai/outputTemplate"] === "string" ? (meta["openai/outputTemplate"] as string) : null);
	if (!uri) return null;
	const props =
		r.structuredContent && typeof r.structuredContent === "object"
			? (r.structuredContent as Record<string, unknown>)
			: undefined;
	const mimeType = typeof meta["ui.mimeType"] === "string" ? (meta["ui.mimeType"] as string) : undefined;
	return {
		resourceUri: uri,
		...(props ? { props } : {}),
		...(mimeType ? { mimeType } : {}),
	};
}

/**
 * Stringify a tool's raw return for OpenAI's `function_call_output`
 * channel. For MCP-shaped returns we send `{ summary, data }` so the
 * model gets both the human text and the structured payload, but the
 * heavy `_meta` (renderer hints) stays inside our process.
 */
function toolResultToFnOutput(result: unknown): string {
	if (!result || typeof result !== "object") return JSON.stringify(result ?? null);
	const r = result as { content?: unknown[]; structuredContent?: unknown };
	if (Array.isArray(r.content)) {
		const summary = r.content.find((c) => (c as { type?: string }).type === "text");
		const summaryText = (summary as { text?: string } | undefined)?.text ?? "";
		return JSON.stringify({
			summary: summaryText,
			data: r.structuredContent ?? null,
		});
	}
	return JSON.stringify(result);
}

const MAX_TOOL_LOOP_ITERATIONS = 24;

/**
 * Streaming variant: yields semantic events (`tool_call_start`,
 * `tool_call_end`, `text_delta`, `done`, `error`) as the agent runs.
 * Frontend hosts get a skeleton-then-data UX with no extra polling.
 *
 * The non-streaming `chatWithAgent` is a thin wrapper over this — it
 * collects events and returns the final aggregate so callers that
 * don't care about progress (e.g., MCP/SDK consumers) keep working.
 */
export type AgentEvent =
	| { type: "tool_call_start"; name: string; args: Record<string, unknown> }
	| { type: "tool_call_end"; name: string; ui?: ExtractedUiHint; error?: string }
	| { type: "text_delta"; delta: string }
	| {
			type: "done";
			sessionId: string;
			runId: string;
			reply: string;
			model: string;
			tokensIn: number;
			tokensOut: number;
			costCents: number;
			ui?: ExtractedUiHint;
		}
	| { type: "error"; code: string; message: string };

export async function* chatWithAgentStream(
	ctx: AgentContext,
	req: {
		message: string;
		sessionId?: string | undefined;
		attachments?: AgentChatAttachment[] | undefined;
		userAction?: AgentChatUserAction | undefined;
	},
): AsyncGenerator<AgentEvent, void, void> {
	if (!config.OPENAI_API_KEY) throw new AgentNotConfiguredError();

	const attachments = req.attachments ?? [];
	for (const a of attachments) {
		if (a.dataUrl.length > ATTACHMENT_DATA_URL_MAX_CHARS) {
			throw new AgentError("attachment_too_large", "Attachment exceeds the 12MB data-URL cap.", 413);
		}
	}
	const effectiveMessage =
		req.message.trim().length > 0 ? req.message : req.userAction ? userActionAsPrompt(req.userAction) : req.message;
	if (effectiveMessage.trim().length === 0 && attachments.length === 0) {
		throw new AgentError("empty_input", "Send a message, attach a file, or send a UI action.", 400);
	}

	let session: AgentSessionRow | null = null;
	if (req.sessionId) {
		const rows = await db
			.select()
			.from(agentSessions)
			.where(and(eq(agentSessions.id, req.sessionId), eq(agentSessions.apiKeyId, ctx.apiKey.id)))
			.limit(1);
		session = (rows[0] as AgentSessionRow | undefined) ?? null;
		if (!session) throw new AgentError("session_not_found", "Session not found for this api key.", 404);
	}

	const rules = await db.select().from(agentRules).where(eq(agentRules.apiKeyId, ctx.apiKey.id));
	const bundle = buildAgentTools(ctx.apiKey);
	const instructions = buildInstructions(rules, bundle != null);

	const startedAt = new Date();
	const model = config.AGENT_OPENAI_MODEL;
	const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
	const userLogText = `${effectiveMessage}${describeAttachmentsForLog(attachments)}`.trim();

	type ResponsesCreateParams = Parameters<typeof openai.responses.create>[0];
	type ResponsesResult = OpenAI.Responses.Response;

	let tokensIn = 0;
	let tokensOut = 0;
	let uiHint: ExtractedUiHint | null = null;
	// `response.output_text` is auto-populated only in non-stream mode.
	// In stream mode the `response.completed` event's response object
	// doesn't carry it, so we accumulate text deltas ourselves.
	let replyBuf = "";

	const baseParams: ResponsesCreateParams = {
		model,
		instructions,
		store: true,
		...(bundle ? { tools: bundle.openaiTools as unknown as ResponsesCreateParams["tools"] } : {}),
	};

	async function persistErrorRun(message: string) {
		const finishedAt = new Date();
		try {
			await db.insert(agentRuns).values({
				apiKeyId: ctx.apiKey.id,
				userId: ctx.apiKey.userId,
				sessionId: session?.id ?? null,
				triggerKind: "chat",
				model,
				userMessage: userLogText,
				reply: null,
				tokensIn,
				tokensOut,
				costCents: costCentsFor(model, tokensIn, tokensOut),
				errorMessage: message.slice(0, 1000),
				startedAt,
				finishedAt,
			});
		} catch {
			/* swallow — best-effort */
		}
	}

	/**
	 * Run one OpenAI streaming `responses.create` call to completion.
	 * Yields `text_delta` and `tool_call_start` semantic events as they
	 * arrive; on completion, returns the final Response object so the
	 * caller can collect output items + token usage. Stuck-chain
	 * recovery (drop `previous_response_id` and retry once) lives here
	 * so it covers every iteration, not just the first.
	 */
	async function* runOpenAIStream(params: ResponsesCreateParams): AsyncGenerator<AgentEvent, ResponsesResult> {
		async function open(p: ResponsesCreateParams) {
			return openai.responses.create({ ...p, stream: true });
		}
		let stream: Awaited<ReturnType<typeof open>>;
		try {
			stream = await open(params);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			const isStuckChain =
				/No tool output found for function call/i.test(msg) &&
				typeof params === "object" &&
				params != null &&
				"previous_response_id" in params;
			if (isStuckChain && session) {
				try {
					await db
						.update(agentSessions)
						.set({ openaiResponseId: "", lastActiveAt: new Date() })
						.where(eq(agentSessions.id, session.id));
				} catch {
					/* swallow */
				}
				const { previous_response_id: _drop, ...rest } = params as ResponsesCreateParams & {
					previous_response_id?: string;
				};
				stream = await open(rest as ResponsesCreateParams);
			} else {
				await persistErrorRun(msg);
				throw new AgentError("upstream_error", `OpenAI: ${msg}`, 502);
			}
		}
		let final: ResponsesResult | null = null;
		const startedCallIds = new Set<string>();
		for await (const ev of stream as AsyncIterable<unknown>) {
			const e = ev as { type?: string; [k: string]: unknown };
			if (e.type === "response.output_text.delta" && typeof e.delta === "string") {
				replyBuf += e.delta;
				yield { type: "text_delta", delta: e.delta };
			} else if (
				e.type === "response.function_call_arguments.done" &&
				typeof e.name === "string"
			) {
				const itemId = typeof e.item_id === "string" ? (e.item_id as string) : "";
				if (!itemId || !startedCallIds.has(itemId)) {
					if (itemId) startedCallIds.add(itemId);
					let args: Record<string, unknown> = {};
					if (typeof e.arguments === "string" && e.arguments.length > 0) {
						try {
							args = JSON.parse(e.arguments) as Record<string, unknown>;
						} catch {
							/* swallow */
						}
					}
					yield { type: "tool_call_start", name: e.name, args };
				}
			} else if (e.type === "response.output_item.done") {
				// Fallback path for models / SDK builds that finalize a
				// function_call without separate args.done events. Emit
				// `tool_call_start` here if we haven't already.
				const item = (e as { item?: { type?: string; name?: string; arguments?: string; id?: string } }).item;
				if (item && item.type === "function_call" && typeof item.name === "string") {
					const itemId = item.id ?? "";
					if (!itemId || !startedCallIds.has(itemId)) {
						if (itemId) startedCallIds.add(itemId);
						let args: Record<string, unknown> = {};
						if (typeof item.arguments === "string" && item.arguments.length > 0) {
							try {
								args = JSON.parse(item.arguments) as Record<string, unknown>;
							} catch {
								/* swallow */
							}
						}
						yield { type: "tool_call_start", name: item.name, args };
					}
				}
			} else if (e.type === "response.completed") {
				final = (e.response ?? null) as ResponsesResult | null;
			}
		}
		if (!final) {
			await persistErrorRun("stream_ended_without_response_completed");
			throw new AgentError("upstream_error", "OpenAI stream ended without response.completed", 502);
		}
		return final;
	}

	let response: ResponsesResult;
	try {
		response = yield* runOpenAIStream({
			...baseParams,
			input: buildResponsesInput(effectiveMessage, attachments) as ResponsesCreateParams["input"],
			...(session?.openaiResponseId ? { previous_response_id: session.openaiResponseId } : {}),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		yield { type: "error", code: "upstream_error", message: msg };
		return;
	}
	tokensIn += response.usage?.input_tokens ?? 0;
	tokensOut += response.usage?.output_tokens ?? 0;

	for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
		const items = Array.isArray(response.output) ? response.output : [];
		const calls = items.filter(
			(it): it is { type: "function_call"; name: string; call_id: string; arguments: string } =>
				(it as { type?: string })?.type === "function_call",
		);
		if (calls.length === 0 || !bundle) break;
		const fnOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
		for (const call of calls) {
			const tool = bundle.tools.find((t) => t.name === call.name);
			if (!tool) {
				yield { type: "tool_call_end", name: call.name, error: "unknown_tool" };
				fnOutputs.push({
					type: "function_call_output",
					call_id: call.call_id,
					output: JSON.stringify({ error: "unknown_tool", name: call.name }),
				});
				continue;
			}
			let args: Record<string, unknown> = {};
			try {
				args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
			} catch {
				args = {};
			}
			let toolResult: unknown;
			let toolError: string | undefined;
			try {
				toolResult = await tool.execute(bundle.mcpConfig, args);
			} catch (err) {
				toolError = err instanceof Error ? err.message : String(err);
				toolResult = { error: "tool_threw", message: toolError };
			}
			const hint = uiHintFromToolResult(toolResult);
			if (hint) uiHint = hint;
			yield {
				type: "tool_call_end",
				name: call.name,
				...(hint ? { ui: hint } : {}),
				...(toolError ? { error: toolError } : {}),
			};
			fnOutputs.push({
				type: "function_call_output",
				call_id: call.call_id,
				output: toolResultToFnOutput(toolResult),
			});
		}
		try {
			response = yield* runOpenAIStream({
				...baseParams,
				previous_response_id: response.id,
				input: fnOutputs as unknown as ResponsesCreateParams["input"],
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			yield { type: "error", code: "upstream_error", message: msg };
			return;
		}
		tokensIn += response.usage?.input_tokens ?? 0;
		tokensOut += response.usage?.output_tokens ?? 0;
	}

	const finishedAt = new Date();
	// Prefer the streamed-delta accumulator; fall back to the SDK's
	// auto-populated `output_text` only when streaming gave us nothing
	// (e.g., model emitted only function_calls and no message item).
	const reply = replyBuf.length > 0 ? replyBuf : (response.output_text ?? "");
	const costCents = costCentsFor(model, tokensIn, tokensOut);
	const finalItems = Array.isArray((response as { output?: unknown[] }).output)
		? ((response as { output?: unknown[] }).output as unknown[])
		: [];
	const hasDanglingCalls = finalItems.some((it) => (it as { type?: string })?.type === "function_call");
	const persistResponseId = hasDanglingCalls ? "" : response.id;

	let sessionId: string;
	if (session) {
		await db
			.update(agentSessions)
			.set({ openaiResponseId: persistResponseId, lastActiveAt: finishedAt })
			.where(eq(agentSessions.id, session.id));
		sessionId = session.id;
	} else {
		const inserted = await db
			.insert(agentSessions)
			.values({
				apiKeyId: ctx.apiKey.id,
				userId: ctx.apiKey.userId,
				openaiResponseId: persistResponseId,
				title: deriveTitle(userLogText || "(attachment)"),
				lastActiveAt: finishedAt,
			})
			.returning({ id: agentSessions.id });
		sessionId = inserted[0]!.id;
	}

	const insertedRun = await db
		.insert(agentRuns)
		.values({
			apiKeyId: ctx.apiKey.id,
			userId: ctx.apiKey.userId,
			sessionId,
			triggerKind: "chat",
			model,
			userMessage: userLogText,
			reply,
			tokensIn,
			tokensOut,
			costCents,
			...(uiHint ? { uiResourceUri: uiHint.resourceUri, uiProps: uiHint.props ?? {} } : {}),
			startedAt,
			finishedAt,
		})
		.returning({ id: agentRuns.id });

	yield {
		type: "done",
		sessionId,
		runId: insertedRun[0]!.id,
		reply,
		model,
		tokensIn,
		tokensOut,
		costCents,
		...(uiHint ? { ui: uiHint } : {}),
	};
}

/**
 * Non-streaming wrapper — collects every event from the stream and
 * returns the final aggregate. Kept for callers that don't care about
 * progress (legacy SDK path, tests).
 */
export async function chatWithAgent(
	ctx: AgentContext,
	req: {
		message: string;
		sessionId?: string | undefined;
		attachments?: AgentChatAttachment[] | undefined;
		userAction?: AgentChatUserAction | undefined;
	},
): Promise<{
	sessionId: string;
	runId: string;
	reply: string;
	model: string;
	tokensIn: number;
	tokensOut: number;
	costCents: number;
	ui?: ExtractedUiHint;
}> {
	let final: Extract<AgentEvent, { type: "done" }> | null = null;
	for await (const event of chatWithAgentStream(ctx, req)) {
		if (event.type === "done") {
			final = event;
		} else if (event.type === "error") {
			throw new AgentError(event.code, event.message, 502);
		}
	}
	if (!final) throw new AgentError("upstream_error", "agent stream ended without done", 502);
	const { type: _t, ...rest } = final;
	return rest;
}

/* ---------------------------- sessions ---------------------------- */

export async function listAgentSessions(ctx: AgentContext) {
	// Pinned threads float to the top (most-recently-pinned first), then
	// the rest by recency. Postgres puts NULLs first by default on DESC,
	// so use `nulls last` for `pinnedAt`.
	const rows = await db
		.select()
		.from(agentSessions)
		.where(eq(agentSessions.apiKeyId, ctx.apiKey.id))
		.orderBy(sql`${agentSessions.pinnedAt} DESC NULLS LAST`, desc(agentSessions.lastActiveAt))
		.limit(100);
	return { sessions: rows.map((r) => rowToSession(r as AgentSessionRow)) };
}

export async function patchAgentSession(
	ctx: AgentContext,
	id: string,
	req: { title?: string | undefined; pinned?: boolean | undefined },
) {
	const updates: Partial<{
		title: string | null;
		pinnedAt: Date | null;
	}> = {};
	if (typeof req.title === "string") updates.title = req.title.trim() || null;
	if (typeof req.pinned === "boolean") updates.pinnedAt = req.pinned ? new Date() : null;
	if (Object.keys(updates).length === 0) {
		throw new AgentError("empty_patch", "Provide at least one of: title, pinned.", 400);
	}
	const result = await db
		.update(agentSessions)
		.set(updates)
		.where(and(eq(agentSessions.id, id), eq(agentSessions.apiKeyId, ctx.apiKey.id)))
		.returning();
	const row = result[0] as AgentSessionRow | undefined;
	if (!row) throw new AgentError("session_not_found", "Session not found for this api key.", 404);
	return rowToSession(row);
}

export async function deleteAgentSession(ctx: AgentContext, id: string): Promise<boolean> {
	const result = await db
		.delete(agentSessions)
		.where(and(eq(agentSessions.id, id), eq(agentSessions.apiKeyId, ctx.apiKey.id)))
		.returning({ id: agentSessions.id });
	return result.length > 0;
}

/* ---------------------------- rules ---------------------------- */

export async function listAgentRules(ctx: AgentContext) {
	const rows = await db
		.select()
		.from(agentRules)
		.where(eq(agentRules.apiKeyId, ctx.apiKey.id))
		.orderBy(desc(agentRules.createdAt));
	return { rules: rows.map((r) => rowToRule(r as AgentRuleRow)) };
}

export async function createAgentRule(
	ctx: AgentContext,
	req: { kind: "rule" | "preference" | "note"; content: string },
) {
	const inserted = await db
		.insert(agentRules)
		.values({
			apiKeyId: ctx.apiKey.id,
			userId: ctx.apiKey.userId,
			kind: req.kind,
			content: req.content,
		})
		.returning();
	return rowToRule(inserted[0] as AgentRuleRow);
}

export async function deleteAgentRule(ctx: AgentContext, id: string): Promise<boolean> {
	const result = await db
		.delete(agentRules)
		.where(and(eq(agentRules.id, id), eq(agentRules.apiKeyId, ctx.apiKey.id)))
		.returning({ id: agentRules.id });
	return result.length > 0;
}

/* ---------------------------- runs ---------------------------- */

export async function listAgentRuns(ctx: AgentContext, opts: { limit?: number; sessionId?: string | undefined } = {}) {
	const limit = opts.limit ?? 50;
	const where = opts.sessionId
		? and(eq(agentRuns.apiKeyId, ctx.apiKey.id), eq(agentRuns.sessionId, opts.sessionId))
		: eq(agentRuns.apiKeyId, ctx.apiKey.id);
	const rows = await db.select().from(agentRuns).where(where).orderBy(desc(agentRuns.startedAt)).limit(limit);
	return { runs: rows.map((r) => rowToRun(r as AgentRunRow)) };
}
