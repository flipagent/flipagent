/**
 * `/v1/agent/*` (preview) — chat with a flipagent-aware agent.
 *
 * Stateful thread: the api persists an OpenAI Responses-API
 * `previous_response_id` per session so subsequent turns ride on the
 * server-side history (no token resending). Rules are stuffed into
 * the system instructions on every turn so user-stated guidance
 * ("never list below $30 margin") survives across sessions.
 *
 * Activity feed = `agent_runs` rows joined with sessions, surfaced via
 * `/v1/agent/runs`.
 */

import { type Static, Type } from "@sinclair/typebox";

export const AgentRuleKind = Type.Union([Type.Literal("rule"), Type.Literal("preference"), Type.Literal("note")], {
	$id: "AgentRuleKind",
});
export type AgentRuleKind = Static<typeof AgentRuleKind>;

export const AgentRule = Type.Object(
	{
		id: Type.String(),
		kind: AgentRuleKind,
		content: Type.String(),
		createdAt: Type.String(),
	},
	{ $id: "AgentRule" },
);
export type AgentRule = Static<typeof AgentRule>;

export const AgentRuleCreate = Type.Object(
	{
		kind: AgentRuleKind,
		content: Type.String({ minLength: 1, maxLength: 2000 }),
	},
	{ $id: "AgentRuleCreate" },
);
export type AgentRuleCreate = Static<typeof AgentRuleCreate>;

export const AgentRuleListResponse = Type.Object({ rules: Type.Array(AgentRule) }, { $id: "AgentRuleListResponse" });
export type AgentRuleListResponse = Static<typeof AgentRuleListResponse>;

export const AgentSession = Type.Object(
	{
		id: Type.String(),
		title: Type.Optional(Type.String()),
		pinnedAt: Type.Optional(Type.String()),
		createdAt: Type.String(),
		lastActiveAt: Type.String(),
	},
	{ $id: "AgentSession" },
);
export type AgentSession = Static<typeof AgentSession>;

export const AgentSessionPatch = Type.Object(
	{
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		pinned: Type.Optional(Type.Boolean()),
	},
	{ $id: "AgentSessionPatch" },
);
export type AgentSessionPatch = Static<typeof AgentSessionPatch>;

export const AgentSessionListResponse = Type.Object(
	{ sessions: Type.Array(AgentSession) },
	{ $id: "AgentSessionListResponse" },
);
export type AgentSessionListResponse = Static<typeof AgentSessionListResponse>;

/**
 * One file attached to a chat turn. Sent inline as a data URL — for the
 * preview surface we don't lean on the OpenAI Files API. `kind=image`
 * lands in the model as an `input_image` content block; `file` (PDFs,
 * text, …) rides as `input_file` with `file_data`. Skip non-image
 * uploads on instances with smaller models.
 */
export const AgentAttachment = Type.Object(
	{
		kind: Type.Union([Type.Literal("image"), Type.Literal("file")]),
		dataUrl: Type.String({ minLength: 1 }),
		mimeType: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
	},
	{ $id: "AgentAttachment" },
);
export type AgentAttachment = Static<typeof AgentAttachment>;

/**
 * Structured user action surfaced from an inline UI iframe (MCP Apps
 * postMessage intent). The chat host translates it into a synthetic
 * prompt that nudges the model toward the next tool call without
 * requiring the user to type anything.
 *
 * `tool` = the iframe wants the agent to call a specific MCP tool.
 * `prompt` = the iframe wants to inject a user prompt as if typed.
 */
export const AgentUserAction = Type.Union(
	[
		Type.Object({
			type: Type.Literal("tool"),
			name: Type.String({ minLength: 1, maxLength: 200 }),
			args: Type.Optional(Type.Record(Type.String(), Type.Any())),
		}),
		Type.Object({
			type: Type.Literal("prompt"),
			text: Type.String({ minLength: 1, maxLength: 8000 }),
		}),
	],
	{ $id: "AgentUserAction" },
);
export type AgentUserAction = Static<typeof AgentUserAction>;

/**
 * Models the agent surface accepts. Free-tier callers are restricted to
 * the cheap pair (`gpt-5.4-mini` and `gemini-2.5-flash`); paid tiers
 * (Hobby / Standard / Growth) unlock `gpt-5.5` and `claude-sonnet-4-7`
 * for stronger reasoning. Per-turn credit cost varies by model — see
 * `agentTurnCreditsFor` in `packages/api/src/auth/limits.ts`.
 */
export const AgentModel = Type.Union(
	[
		Type.Literal("gpt-5.4-mini"),
		Type.Literal("gpt-5.5"),
		Type.Literal("claude-sonnet-4-7"),
		Type.Literal("gemini-2.5-flash"),
	],
	{ $id: "AgentModel" },
);
export type AgentModel = Static<typeof AgentModel>;

export const AgentChatRequest = Type.Object(
	{
		/**
		 * The user message. Allowed to be empty when at least one
		 * attachment is present (image-only turns are valid) or when a
		 * `userAction` is supplied (UI-driven turns).
		 */
		message: Type.String({ maxLength: 8000 }),
		/** Continue an existing thread; omit to start a fresh one. */
		sessionId: Type.Optional(Type.String()),
		attachments: Type.Optional(Type.Array(AgentAttachment, { maxItems: 8 })),
		/**
		 * Structured intent posted from an inline UI component. When set,
		 * the agent service injects a synthetic prompt describing the
		 * action so the model picks it up as ordinary user input.
		 */
		userAction: Type.Optional(AgentUserAction),
		/**
		 * Override the underlying LLM. Defaults to the instance's
		 * `AGENT_OPENAI_MODEL` (currently `gpt-5.4-mini`). `gpt-5.5` is
		 * paid-tier only; the route returns 403 with an upgrade pointer
		 * if a Free-tier caller asks for it.
		 */
		model: Type.Optional(AgentModel),
	},
	{ $id: "AgentChatRequest" },
);
export type AgentChatRequest = Static<typeof AgentChatRequest>;

/**
 * MCP Apps UI hint, surfaced to the frontend chat renderer when a tool
 * call attached `_meta.ui.resourceUri`. The renderer mounts the URI in
 * an iframe (resolved via the `@mcp-ui/client` UIResourceRenderer) and
 * passes `props` over postMessage init. `null` resourceUri = plain
 * text reply (markdown).
 */
export const AgentUiHint = Type.Object(
	{
		resourceUri: Type.String(),
		props: Type.Optional(Type.Record(Type.String(), Type.Any())),
		mimeType: Type.Optional(Type.String()),
	},
	{ $id: "AgentUiHint" },
);
export type AgentUiHint = Static<typeof AgentUiHint>;

export const AgentChatResponse = Type.Object(
	{
		sessionId: Type.String(),
		runId: Type.String(),
		reply: Type.String(),
		model: Type.String(),
		tokensIn: Type.Integer(),
		tokensOut: Type.Integer(),
		costCents: Type.Integer(),
		ui: Type.Optional(AgentUiHint),
	},
	{ $id: "AgentChatResponse" },
);
export type AgentChatResponse = Static<typeof AgentChatResponse>;

export const AgentRunTriggerKind = Type.Union([Type.Literal("chat"), Type.Literal("cron"), Type.Literal("webhook")], {
	$id: "AgentRunTriggerKind",
});
export type AgentRunTriggerKind = Static<typeof AgentRunTriggerKind>;

export const AgentRun = Type.Object(
	{
		id: Type.String(),
		sessionId: Type.Optional(Type.String()),
		triggerKind: AgentRunTriggerKind,
		model: Type.Optional(Type.String()),
		userMessage: Type.Optional(Type.String()),
		reply: Type.Optional(Type.String()),
		tokensIn: Type.Integer(),
		tokensOut: Type.Integer(),
		costCents: Type.Integer(),
		errorMessage: Type.Optional(Type.String()),
		ui: Type.Optional(AgentUiHint),
		startedAt: Type.String(),
		finishedAt: Type.Optional(Type.String()),
	},
	{ $id: "AgentRun" },
);
export type AgentRun = Static<typeof AgentRun>;

export const AgentRunListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		sessionId: Type.Optional(Type.String()),
	},
	{ $id: "AgentRunListQuery" },
);
export type AgentRunListQuery = Static<typeof AgentRunListQuery>;

export const AgentRunListResponse = Type.Object({ runs: Type.Array(AgentRun) }, { $id: "AgentRunListResponse" });
export type AgentRunListResponse = Static<typeof AgentRunListResponse>;

/**
 * Server-sent events emitted while the agent processes a chat turn.
 * The host requests `Accept: text/event-stream` on POST `/v1/agent/chat`
 * to opt in. Events are framed as standard SSE `data: <json>\n\n`.
 *
 *   - `tool_call_start` — model decided to call a tool; emitted as
 *     soon as the args stream finalizes (typically <1s in). Use this
 *     to render a skeleton of the predicted UI before the tool runs.
 *   - `tool_call_end` — tool dispatch finished; carries the UI hint
 *     (if any) so the host can swap the skeleton's props in place.
 *   - `text_delta` — chunk of the assistant's natural-language reply
 *     as the model generates it.
 *   - `done` — terminal; mirrors the non-streaming response shape.
 *   - `error` — terminal; surface and stop reading.
 */
export const AgentStreamEvent = Type.Union(
	[
		Type.Object({
			type: Type.Literal("tool_call_start"),
			name: Type.String(),
			args: Type.Record(Type.String(), Type.Any()),
		}),
		Type.Object({
			type: Type.Literal("tool_call_end"),
			name: Type.String(),
			ui: Type.Optional(AgentUiHint),
			error: Type.Optional(Type.String()),
		}),
		Type.Object({
			type: Type.Literal("text_delta"),
			delta: Type.String(),
		}),
		Type.Object({
			type: Type.Literal("done"),
			sessionId: Type.String(),
			runId: Type.String(),
			reply: Type.String(),
			model: Type.String(),
			tokensIn: Type.Integer(),
			tokensOut: Type.Integer(),
			costCents: Type.Integer(),
			ui: Type.Optional(AgentUiHint),
		}),
		Type.Object({
			type: Type.Literal("error"),
			code: Type.String(),
			message: Type.String(),
		}),
	],
	{ $id: "AgentStreamEvent" },
);
export type AgentStreamEvent = Static<typeof AgentStreamEvent>;
