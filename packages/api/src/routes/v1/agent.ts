/**
 * `/v1/agent/*` (preview) — chat with the flipagent reseller agent.
 *
 *   POST /chat                    — one turn (kicks off or continues a thread)
 *   GET  /sessions                — recent threads for this api key
 *   GET  /rules / POST /rules / DELETE /rules/:id
 *                                 — user-stated guidance the agent
 *                                   sees on every turn
 *   GET  /runs                    — activity feed (latest first)
 *
 * All endpoints scope on the caller's api key. Returns 503 when
 * `OPENAI_API_KEY` is unset (mirrors billing/eBay opt-in pattern).
 */

import {
	AgentChatRequest,
	AgentChatResponse,
	AgentRule,
	AgentRuleCreate,
	AgentRuleListResponse,
	AgentRunListQuery,
	AgentRunListResponse,
	AgentSession,
	AgentSessionListResponse,
	AgentSessionPatch,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { streamSSE } from "hono/streaming";
import { isAgentConfigured } from "../../config.js";
import { requireApiKey } from "../../middleware/auth.js";
import {
	AgentError,
	AgentNotConfiguredError,
	chatWithAgent,
	chatWithAgentStream,
	createAgentRule,
	deleteAgentRule,
	deleteAgentSession,
	listAgentRules,
	listAgentRuns,
	listAgentSessions,
	patchAgentSession,
} from "../../services/agent/operations.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const agentRoute = new Hono();

const NOT_CONFIGURED = {
	error: "agent_not_configured" as const,
	message: "OPENAI_API_KEY is not set on this instance — /v1/agent/* is disabled.",
};

agentRoute.post(
	"/chat",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "Send one chat turn",
		description:
			"Kicks off a new thread (omit `sessionId`) or continues an existing one. State lives on OpenAI's side via the Responses API; flipagent stores only the most recent `response.id` per session.",
		responses: {
			200: jsonResponse("Reply.", AgentChatResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Auth missing."),
			404: errorResponse("Session not found."),
			502: errorResponse("Upstream OpenAI error."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	tbBody(AgentChatRequest),
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const body = c.req.valid("json");
		const wantsStream = (c.req.header("accept") ?? "").includes("text/event-stream");

		if (wantsStream) {
			// SSE: stream semantic events as the agent runs. Each frame is a
			// single `data: <json>\n\n`; clients parse JSON per frame and
			// handle by `event.type` (tool_call_start | tool_call_end |
			// text_delta | done | error).
			return streamSSE(c, async (sse) => {
				try {
					for await (const event of chatWithAgentStream(
						{ apiKey },
						{
							message: body.message,
							sessionId: body.sessionId,
							attachments: body.attachments,
							userAction: body.userAction,
						},
					)) {
						await sse.writeSSE({ data: JSON.stringify(event) });
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					const code =
						err instanceof AgentError
							? err.code
							: err instanceof AgentNotConfiguredError
								? "agent_not_configured"
								: "stream_error";
					await sse.writeSSE({ data: JSON.stringify({ type: "error", code, message: msg }) });
				}
			});
		}

		try {
			const result = await chatWithAgent(
				{ apiKey },
				{
					message: body.message,
					sessionId: body.sessionId,
					attachments: body.attachments,
					userAction: body.userAction,
				},
			);
			return c.json(result);
		} catch (err) {
			if (err instanceof AgentNotConfiguredError) return c.json(NOT_CONFIGURED, 503);
			if (err instanceof AgentError) {
				return c.json({ error: err.code, message: err.message }, err.status as 400 | 404 | 413 | 502);
			}
			throw err;
		}
	},
);

agentRoute.patch(
	"/sessions/:id",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "Update an agent session (rename, pin/unpin)",
		description:
			"Patch the session's `title` (rename) and/or `pinned` (favorite). Pinned threads sort to the top of the list.",
		responses: {
			200: jsonResponse("Updated session.", AgentSession),
			400: errorResponse("Validation failed."),
			401: errorResponse("Auth missing."),
			404: errorResponse("Session not found."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	tbBody(AgentSessionPatch),
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const id = c.req.param("id");
		const body = c.req.valid("json");
		try {
			const result = await patchAgentSession({ apiKey }, id, body);
			return c.json(result);
		} catch (err) {
			if (err instanceof AgentError) {
				return c.json({ error: err.code, message: err.message }, err.status as 400 | 404);
			}
			throw err;
		}
	},
);

agentRoute.delete(
	"/sessions/:id",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "Delete an agent session",
		description: "Removes the session and its runs (cascade). The OpenAI thread itself is left as-is on OpenAI's side.",
		responses: {
			200: { description: "Deleted." },
			401: errorResponse("Auth missing."),
			404: errorResponse("Session not found."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const id = c.req.param("id");
		const ok = await deleteAgentSession({ apiKey }, id);
		if (!ok) return c.json({ error: "session_not_found" as const, message: "Session not found." }, 404);
		return c.json({ ok: true });
	},
);

agentRoute.get(
	"/sessions",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "List recent agent sessions",
		responses: {
			200: jsonResponse("Sessions.", AgentSessionListResponse),
			401: errorResponse("Auth missing."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const result = await listAgentSessions({ apiKey });
		return c.json(result);
	},
);

agentRoute.get(
	"/rules",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "List agent rules and preferences",
		responses: {
			200: jsonResponse("Rules.", AgentRuleListResponse),
			401: errorResponse("Auth missing."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const result = await listAgentRules({ apiKey });
		return c.json(result);
	},
);

agentRoute.post(
	"/rules",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "Add an agent rule, preference, or note",
		description:
			"Saved guidance is stuffed into the system instructions on every chat turn. Updates take effect on the next message — no thread reset.",
		responses: {
			200: jsonResponse("Created.", AgentRule),
			400: errorResponse("Validation failed."),
			401: errorResponse("Auth missing."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	tbBody(AgentRuleCreate),
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const body = c.req.valid("json");
		const result = await createAgentRule({ apiKey }, { kind: body.kind, content: body.content });
		return c.json(result, 201);
	},
);

agentRoute.delete(
	"/rules/:id",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "Delete an agent rule",
		responses: {
			200: { description: "Deleted." },
			401: errorResponse("Auth missing."),
			404: errorResponse("Rule not found."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const id = c.req.param("id");
		const ok = await deleteAgentRule({ apiKey }, id);
		if (!ok) return c.json({ error: "rule_not_found" as const, message: "Rule not found." }, 404);
		return c.json({ ok: true });
	},
);

agentRoute.get(
	"/runs",
	describeRoute({
		tags: ["Agent (preview)"],
		summary: "Activity feed — recent agent runs",
		parameters: paramsFor("query", AgentRunListQuery),
		responses: {
			200: jsonResponse("Runs.", AgentRunListResponse),
			401: errorResponse("Auth missing."),
			503: errorResponse("Agent not configured."),
		},
	}),
	requireApiKey,
	tbCoerce("query", AgentRunListQuery),
	async (c) => {
		if (!isAgentConfigured()) return c.json(NOT_CONFIGURED, 503);
		const apiKey = c.var.apiKey;
		const limitRaw = c.req.query("limit");
		const sessionId = c.req.query("sessionId") || undefined;
		const result = await listAgentRuns({ apiKey }, { limit: limitRaw ? Number(limitRaw) : 50, sessionId });
		return c.json(result);
	},
);
