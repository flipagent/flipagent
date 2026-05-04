/**
 * `/v1/agent/*` (preview) — chat with a flipagent-aware agent.
 *
 * Multi-provider via the Vercel AI SDK: OpenAI (gpt-5.4-mini, gpt-5.5),
 * Anthropic (claude-sonnet-4-7), and Google (gemini-2.5-flash) ride on
 * the same `streamText` API. Conversation state is held locally in
 * `agent_sessions.messages` (JSONB array of `ModelMessage`) — none of
 * the three providers expose a stateful thread API equivalent to
 * OpenAI's `previous_response_id`, so we always send the full history.
 *
 * User-stated rules / preferences live in `agent_rules` and are folded
 * into the system instructions every turn — that way an updated rule
 * kicks in immediately without resetting the thread.
 *
 * Tools come from `flipagent-mcp`. We dispatch them in-process (NOT via
 * the AI SDK's MCP client) so the full MCP CallTool result flows back
 * unchanged: `_meta.ui.resourceUri` + `structuredContent` are
 * captured into a per-request map keyed on `toolCallId`, then attached
 * to the `tool_call_end` event for inline-UI rendering. The standalone
 * `/mcp` HTTP endpoint stays available for external clients (Claude
 * Desktop, etc.) that want native MCP.
 *
 * Cost: per-call OpenAI/Anthropic/Google token rates — see
 * `MODEL_PRICING_PER_1M`. We snapshot tokens + a rounded `cost_cents`
 * per run; sub-cent runs round to 0 (recompute precisely from tokens
 * when it matters).
 */

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { jsonSchema, type LanguageModel, type ModelMessage, stepCountIs, streamText, type ToolSet, tool } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Config as McpConfig } from "flipagent-mcp/config";
import { type Tool as McpTool, selectTools } from "flipagent-mcp/tools";
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
		super("Agent not configured: no LLM provider key set (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY).");
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
	 *  the in-process MCP tool dispatcher. */
	apiKey: ApiKey;
}

/**
 * Per-1M-token raw $ pricing for each supported model. Used to compute
 * `cost_cents` on every run. Update when a provider shifts the meter.
 * Unknown models charge 0 (run still persists with truthful tokens).
 */
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
	"gpt-5.4-mini": { input: 0.25, output: 2 },
	"gpt-5.5": { input: 5, output: 30 },
	"claude-sonnet-4-7": { input: 3, output: 15 },
	"gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

function costCentsFor(model: string, tokensIn: number, tokensOut: number): number {
	const tier = MODEL_PRICING_PER_1M[model];
	if (!tier) return 0;
	const dollars = (tokensIn * tier.input + tokensOut * tier.output) / 1_000_000;
	return Math.round(dollars * 100);
}

/**
 * Convert any error-shaped value to a human-readable string. AI SDK
 * stream events sometimes carry a plain object (`{ name, message,
 * cause }`) instead of an actual `Error` instance — `String(obj)` on
 * that returns "[object Object]", which then lands in the agent_runs
 * error_message column and gets shown to the user. This walks the
 * known error shapes (Error, string, object-with-message,
 * object-with-error.message, JSON fallback) and only resorts to
 * "unknown_error" when nothing useful can be extracted.
 */
function describeError(err: unknown): string {
	if (err instanceof Error) return err.message || err.name || "Error";
	if (typeof err === "string") return err;
	if (err && typeof err === "object") {
		const o = err as { message?: unknown; error?: { message?: unknown }; name?: unknown };
		if (typeof o.message === "string" && o.message.length > 0) return o.message;
		if (o.error && typeof o.error === "object") {
			const inner = (o.error as { message?: unknown }).message;
			if (typeof inner === "string" && inner.length > 0) return inner;
		}
		if (typeof o.name === "string" && o.name.length > 0) return o.name;
		try {
			const json = JSON.stringify(err);
			if (json && json !== "{}") return json;
		} catch {
			/* fall through */
		}
	}
	return "unknown_error";
}

/**
 * Resolve a model id to a Vercel AI SDK `LanguageModel`. The provider
 * is selected from the prefix; route-level tier gating already
 * validates the id before we get here. Throws `AgentError` when the
 * required provider key isn't configured for that prefix.
 */
function pickModel(modelId: string): LanguageModel {
	if (modelId.startsWith("gpt-")) {
		if (!config.OPENAI_API_KEY) throw new AgentError("model_provider_not_configured", `OPENAI_API_KEY not set.`, 503);
		return openai(modelId);
	}
	if (modelId.startsWith("claude-")) {
		if (!config.ANTHROPIC_API_KEY)
			throw new AgentError("model_provider_not_configured", `ANTHROPIC_API_KEY not set.`, 503);
		return anthropic(modelId);
	}
	if (modelId.startsWith("gemini-")) {
		if (!config.GOOGLE_API_KEY) throw new AgentError("model_provider_not_configured", `GOOGLE_API_KEY not set.`, 503);
		return google(modelId);
	}
	throw new AgentError("unknown_model", `Model "${modelId}" is not registered.`, 400);
}

/**
 * Build the system instructions sent to the model on every turn.
 * Updated rules take effect on the very next message — no thread reset
 * needed.
 */
function buildInstructions(rules: AgentRuleRow[], mcpEnabled: boolean): string {
	const today = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		"You are flipagent's reseller agent. You help users run an eBay reselling business.",
		"You can answer questions and explain decisions about sourcing, listing, pricing, and fulfillment.",
	];
	if (mcpEnabled) {
		lines.push(
			"Live data: you have the full `flipagent` MCP toolset wired up. Call `flipagent_get_capabilities` first when the user is new — it tells you which surfaces (eBay OAuth, extension, forwarder) are ready. Use specific tools (search_items, get_item, evaluate_item, list_listings, list_sales, list_payouts, etc.) for fresh data; don't fabricate numbers.",
			'Do NOT narrate while tool calls are in flight. The host shows the user a live status indicator ("Searching listings…", "Evaluating…") for every tool call, plus the result UI inline. Stay silent until you have results, then write ONE concise reply summarizing what landed. No "Let me check…", no "I\'ll look that up", no announcing tools by name.',
			"Write tools (buy, bid, list, end-listing, ship, cancel, send-message, leave-feedback, respond-to-dispute/offer, register/revoke webhook, opt-in/out program, dispatch package) all work. Execute them when the user gives an explicit instruction. For irreversible or buyer/seller-visible actions, echo the key parameters back in one line BEFORE calling the tool (\"Placing a $42 bid on item 12345…\") so the user can interrupt. If the user's instruction is ambiguous or you'd be guessing at amounts/recipients, ask one clarifying question first.",
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
 * Build the in-process MCP tool catalog the agent dispatches. We do
 * NOT use the AI SDK's `experimental_createMCPClient` because we need
 * the full MCP CallTool envelope (incl. `_meta.ui.resourceUri` +
 * `structuredContent`) to flow back unchanged for our inline-UI
 * round-trip.
 *
 * Bails (returns null) when:
 *   - the api key has no stored ciphertext (legacy keys)
 *   - the reveal helper isn't configured (no KEYS_ENCRYPTION_KEY in prod)
 *
 * Bail = chat keeps working, just without tool access.
 */
interface AgentToolBundle {
	tools: McpTool[];
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
	const mcpConfig: McpConfig = {
		flipagentBaseUrl: `http://127.0.0.1:${config.PORT}`,
		authToken: plaintext,
		mock: false,
		userAgent: "flipagent-agent/0.0.1",
		enabledToolsets: ["*"],
	};
	return { tools, mcpConfig };
}

/**
 * Wrap MCP tools as Vercel AI SDK `Tool` objects. Each `execute` runs
 * our existing in-process `tool.execute(mcpConfig, args)` so we keep
 * the full MCP envelope. UI hints get stashed in
 * `uiHintsByCallId` (closure-scoped) keyed on the AI SDK's
 * `toolCallId`, then surfaced on the matching `tool-result` stream
 * event.
 *
 * Tool input schemas are TypeBox → JSON Schema. We pass them through
 * `jsonSchema()` so the AI SDK accepts them natively.
 */
function buildAiSdkTools(bundle: AgentToolBundle, uiHintsByCallId: Map<string, ExtractedUiHint>): ToolSet {
	const out: ToolSet = {};
	for (const t of bundle.tools) {
		const description = t.description.length > 1024 ? `${t.description.slice(0, 1020)}…` : t.description;
		out[t.name] = tool({
			description,
			// AI SDK's typed `tool()` wants an InferenceSchema; we feed our
			// TypeBox-derived JSON Schema, which is correct at runtime
			// even though the TS bridge can't see it.
			inputSchema: jsonSchema((t.inputSchema as any) ?? { type: "object", properties: {} }) as any,
			execute: async (args, options) => {
				let result: unknown;
				try {
					result = await t.execute(bundle.mcpConfig, args as Record<string, unknown>);
				} catch (err) {
					const message = describeError(err);
					return JSON.stringify({ error: "tool_threw", message });
				}
				const hint = uiHintFromToolResult(result);
				if (hint && options?.toolCallId) uiHintsByCallId.set(options.toolCallId, hint);
				// Feed the model just the summary + structured payload.
				// `_meta` (renderer hints) stays inside our process via the
				// `uiHintsByCallId` side channel.
				return toolResultToFnOutput(result);
			},
		});
	}
	return out;
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
 * comfortably under provider per-image ceilings (~20MB). Bigger files
 * are rejected at the route boundary; we re-check here so service
 * callers get the same guard.
 */
const ATTACHMENT_DATA_URL_MAX_CHARS = 12 * 1024 * 1024;

/**
 * Build the AI SDK `ModelMessage` for the user's turn. Image/file
 * attachments ride as additional content parts on the same message.
 * The SDK normalises these to provider-native shapes (OpenAI
 * `input_image`, Anthropic `image` block, Gemini `inlineData`) so this
 * one shape works for all three.
 */
function buildUserMessage(message: string, attachments: AgentChatAttachment[]): ModelMessage {
	if (attachments.length === 0) return { role: "user", content: message };
	const parts: Array<
		| { type: "text"; text: string }
		| { type: "image"; image: string; mediaType?: string }
		| { type: "file"; data: string; mediaType: string; filename?: string }
	> = [];
	if (message.length > 0) parts.push({ type: "text", text: message });
	for (const a of attachments) {
		if (a.kind === "image") {
			parts.push({ type: "image", image: a.dataUrl, ...(a.mimeType ? { mediaType: a.mimeType } : {}) });
		} else {
			parts.push({
				type: "file",
				data: a.dataUrl,
				mediaType: a.mimeType ?? "application/octet-stream",
				...(a.name ? { filename: a.name } : {}),
			});
		}
	}
	return { role: "user", content: parts };
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
 * UI hint extracted from an MCP CallTool result's `_meta`. We prefer
 * the LAST hint of a multi-tool turn so the host renders the most
 * recent UI surface (e.g., search → evaluate → renders evaluate).
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
 * Stringify a tool's raw return for the AI SDK tool-result channel.
 * For MCP-shaped returns we send `{ summary, data }` so the model
 * gets both the human text and the structured payload, but the heavy
 * `_meta` (renderer hints) stays inside our process.
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
		/** Per-request model override. Tier-permission is enforced in the
		 *  route layer; this service trusts whatever it gets and falls
		 *  back to `config.AGENT_OPENAI_MODEL` when undefined. */
		model?: string | undefined;
	},
): AsyncGenerator<AgentEvent, void, void> {
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
	const modelId = req.model ?? config.AGENT_OPENAI_MODEL;
	let modelInstance: LanguageModel;
	try {
		modelInstance = pickModel(modelId);
	} catch (err) {
		if (err instanceof AgentError) {
			yield { type: "error", code: err.code, message: err.message };
			return;
		}
		throw err;
	}
	const userLogText = `${effectiveMessage}${describeAttachmentsForLog(attachments)}`.trim();

	// Load prior history from the session row (defaults to empty for
	// fresh sessions). We persist `ModelMessage[]` directly — the AI SDK
	// accepts that shape verbatim and providers normalise it.
	const priorMessages: ModelMessage[] = Array.isArray(session?.messages) ? (session.messages as ModelMessage[]) : [];

	const userMessage = buildUserMessage(effectiveMessage, attachments);
	const inputMessages: ModelMessage[] = [...priorMessages, userMessage];

	const uiHintsByCallId = new Map<string, ExtractedUiHint>();
	let lastUiHint: ExtractedUiHint | null = null;
	let replyBuf = "";
	let tokensIn = 0;
	let tokensOut = 0;

	async function persistErrorRun(message: string) {
		const finishedAt = new Date();
		try {
			await db.insert(agentRuns).values({
				apiKeyId: ctx.apiKey.id,
				userId: ctx.apiKey.userId,
				sessionId: session?.id ?? null,
				triggerKind: "chat",
				model: modelId,
				userMessage: userLogText,
				reply: null,
				tokensIn,
				tokensOut,
				costCents: costCentsFor(modelId, tokensIn, tokensOut),
				errorMessage: message.slice(0, 1000),
				startedAt,
				finishedAt,
			});
		} catch {
			/* swallow — best-effort */
		}
	}

	const aiTools = bundle ? buildAiSdkTools(bundle, uiHintsByCallId) : undefined;

	const result = streamText({
		model: modelInstance,
		system: instructions,
		messages: inputMessages,
		...(aiTools ? { tools: aiTools } : {}),
		stopWhen: stepCountIs(MAX_TOOL_LOOP_ITERATIONS),
	});

	try {
		for await (const part of result.fullStream) {
			switch (part.type) {
				case "text-delta": {
					const delta = (part as { type: "text-delta"; text?: string; delta?: string }).text ?? "";
					if (delta) {
						replyBuf += delta;
						yield { type: "text_delta", delta };
					}
					break;
				}
				case "tool-call": {
					const tc = part as { type: "tool-call"; toolName: string; input?: unknown };
					const args = tc.input && typeof tc.input === "object" ? (tc.input as Record<string, unknown>) : {};
					yield { type: "tool_call_start", name: tc.toolName, args };
					break;
				}
				case "tool-result": {
					const tr = part as {
						type: "tool-result";
						toolName: string;
						toolCallId: string;
						output?: unknown;
					};
					const hint = uiHintsByCallId.get(tr.toolCallId);
					if (hint) lastUiHint = hint;
					yield {
						type: "tool_call_end",
						name: tr.toolName,
						...(hint ? { ui: hint } : {}),
					};
					break;
				}
				case "tool-error": {
					const te = part as { type: "tool-error"; toolName: string; error?: unknown };
					const message = describeError(te.error ?? "tool_error");
					yield { type: "tool_call_end", name: te.toolName, error: message };
					break;
				}
				case "error": {
					const ee = part as { type: "error"; error?: unknown };
					const msg = describeError(ee.error ?? "stream_error");
					await persistErrorRun(msg);
					yield { type: "error", code: "upstream_error", message: msg };
					return;
				}
				default:
					/* ignore other event types (start, finish, reasoning, …) */
					break;
			}
		}
	} catch (err) {
		const msg = describeError(err);
		await persistErrorRun(msg);
		yield { type: "error", code: "upstream_error", message: msg };
		return;
	}

	const usage = await result.totalUsage;
	tokensIn = usage.inputTokens ?? 0;
	tokensOut = usage.outputTokens ?? 0;

	// Append assistant turn(s) to the history. `result.response.messages`
	// returns just the messages produced this turn (assistant + any
	// tool-result entries); we stash them after the prior + user pair to
	// build the next turn's input.
	const responseMessages = (await result.response).messages as ModelMessage[];
	const updatedMessages: ModelMessage[] = [...inputMessages, ...responseMessages];

	const finishedAt = new Date();
	const reply = replyBuf;
	const costCents = costCentsFor(modelId, tokensIn, tokensOut);

	let sessionId: string;
	if (session) {
		await db
			.update(agentSessions)
			.set({ messages: updatedMessages, lastActiveAt: finishedAt })
			.where(eq(agentSessions.id, session.id));
		sessionId = session.id;
	} else {
		const inserted = await db
			.insert(agentSessions)
			.values({
				apiKeyId: ctx.apiKey.id,
				userId: ctx.apiKey.userId,
				messages: updatedMessages,
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
			model: modelId,
			userMessage: userLogText,
			reply,
			tokensIn,
			tokensOut,
			costCents,
			...(lastUiHint ? { uiResourceUri: lastUiHint.resourceUri, uiProps: lastUiHint.props ?? {} } : {}),
			startedAt,
			finishedAt,
		})
		.returning({ id: agentRuns.id });

	yield {
		type: "done",
		sessionId,
		runId: insertedRun[0]!.id,
		reply,
		model: modelId,
		tokensIn,
		tokensOut,
		costCents,
		...(lastUiHint ? { ui: lastUiHint } : {}),
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
		model?: string | undefined;
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
