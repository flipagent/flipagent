/**
 * `/v1/evaluate/*` — single-item judgment. flipagent's "should I buy
 * this listing?" surface. Wraps the local scoring services so all SDK
 * clients (TS today, future Python/Rust) get identical verdicts via
 * one HTTP call.
 *
 *   POST /v1/evaluate           — full deal verdict (rating + signals + landed cost)
 *   POST /v1/evaluate/signals   — fired signal detectors only (no verdict)
 *
 * Maps to the Decisions pillar on the marketing site (#01: numbers
 * decide, not vibes).
 */

import { EvaluateRequest, EvaluateResponse, EvaluateSignalsRequest, EvaluateSignalsResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { evaluate, signalsFor } from "../../services/scoring/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const evaluateRoute = new Hono();

evaluateRoute.post(
	"/",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Score a single listing as a flip opportunity",
		description:
			"Pass at least a handful of `opts.comps` for margin math; without them the verdict is `skip`. Set `opts.forwarder` to attach a US-domestic landed cost. ItemSummary inputs lack `description`, which lowers the confidence multiplier — pass an ItemDetail or override `opts.minConfidence` for a confident `buy`.",
		responses: {
			200: jsonResponse("Deal verdict.", EvaluateResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(EvaluateRequest),
	async (c) => {
		const { item, opts } = c.req.valid("json");
		const verdict = evaluate(item, opts);
		return c.json(verdict);
	},
);

evaluateRoute.post(
	"/signals",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Run signal detectors over a listing (no verdict)",
		description:
			"Returns the hits from `under_median`, `ending_soon_low_watchers`, and `poor_title` detectors. `under_median` requires `comps`; the others run unconditionally. Use this when the agent wants raw evidence to feed a custom scoring policy.",
		responses: {
			200: jsonResponse("Fired signal hits.", EvaluateSignalsResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(EvaluateSignalsRequest),
	async (c) => {
		const { item, comps } = c.req.valid("json");
		const signals = signalsFor(item, comps ?? []);
		return c.json({ signals });
	},
);
