/**
 * `/v1/traces/*` — opt-out telemetry from delegate-mode callers.
 *
 * Single endpoint today: `POST /v1/traces/match` accepts the decisions
 * a host's own LLM produced after `/v1/match` returned a delegate
 * prompt. We store the (anonymised) result so we can keep our own
 * scoring math calibrated as host models drift.
 *
 * Why it exists: hosted-mode runs feed our calibration loop for free
 * (we ran the LLM, we have the trace). Delegate-mode runs are
 * invisible to us by default — `/v1/traces/match` is the bridge that
 * keeps the calibration data warm without forcing the caller to use
 * hosted mode.
 *
 * Anonymisation:
 *  - No `apiKeyId` link. Only a SHA-256 of the key prefix for
 *    rate-limit accounting.
 *  - Snapshot stored at /v1/match request time; this endpoint only
 *    appends decisions + the host-LLM model name.
 *
 * Caller-side opt-out: the SDK / CLI / MCP read `FLIPAGENT_TELEMETRY`
 * before calling this endpoint at all. The endpoint itself accepts
 * any authenticated request — opt-out is enforced one layer up so a
 * user disabling telemetry never even talks to us.
 */

import { MatchTraceRequest, MatchTraceResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { finaliseDelegateTrace } from "../../services/match/trace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const tracesRoute = new Hono();

tracesRoute.post(
	"/match",
	describeRoute({
		tags: ["Traces"],
		summary: "Post delegate-mode match decisions for calibration",
		description:
			"After running `/v1/match` with `mode: 'delegate'` and feeding the prompt to your own LLM, post the decisions here so flipagent can keep its calibration data warm. Anonymous — no API key → trace link is stored. Opt out entirely by setting `FLIPAGENT_TELEMETRY=0` (the SDK / CLI / MCP all check this and skip the call).",
		responses: {
			200: jsonResponse("Stored.", MatchTraceResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Trace id not found (most likely expired)."),
			409: errorResponse("Trace already completed."),
		},
	}),
	requireApiKey,
	tbBody(MatchTraceRequest),
	async (c) => {
		const body = c.req.valid("json");
		const result = await finaliseDelegateTrace({
			traceId: body.traceId,
			decisions: body.decisions,
			llmModel: body.llmModel,
			clientVersion: body.clientVersion,
		});
		if (!result.ok) {
			if (result.reason === "not_found") {
				return c.json({ error: "trace_not_found", message: "No trace with this id." }, 404);
			}
			return c.json({ error: "trace_already_completed", message: "This trace was already finalised." }, 409);
		}
		return c.json({ ok: true as const, stored: result.stored });
	},
);
