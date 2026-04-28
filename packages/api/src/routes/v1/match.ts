/**
 * `/v1/match` — comp-curation. Given a candidate listing + a pool of
 * search results, returns each pool item bucketed as match / borderline
 * / reject with a 0–1 score and a one-line reason. Distinct from
 * `/v1/research/thesis` (statistics over already-matched comps) and
 * `/v1/evaluate` (margin verdict). Run this BEFORE either: skipping it
 * inflates the comp pool with similar-but-different SKUs and gives a
 * wrong median (Gucci YA1264153 example: $450 mixed median collapses
 * to $350 once true-match comps are isolated).
 */

import { MatchRequest, MatchResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { matchPool } from "../../services/match/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const matchRoute = new Hono();

matchRoute.post(
	"/",
	describeRoute({
		tags: ["Match"],
		summary: "Bucket a pool of comps as match / borderline / reject against a candidate",
		description:
			"Pure deterministic classifier — IDF-weighted title overlap + condition equality. Use the `match` bucket directly as comps; inspect each `borderline` (fetch detail, compare aspects + image) before keeping or dropping; ignore `reject`. Feed the curated set into `/v1/research/thesis` and `/v1/evaluate` for a reliable verdict.",
		responses: {
			200: jsonResponse("Three-bucket classification.", MatchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(MatchRequest),
	async (c) => {
		const { candidate, pool, options } = c.req.valid("json");
		return c.json(matchPool(candidate, pool, options ?? {}));
	},
);
