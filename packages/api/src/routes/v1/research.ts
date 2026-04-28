/**
 * `/v1/research/*` — market thesis. The bundle the agent computes once
 * per SKU and reuses across `/v1/discover`, `/v1/evaluate`, `/v1/draft`,
 * `/v1/reprice`.
 *
 *   POST /v1/research/thesis    — distribution + (optional) EV-optimal list price
 *
 * Maps to the Decisions pillar (#01) — the read-side feeder for every
 * intelligence call.
 */

import { ResearchThesisRequest, ResearchThesisResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { thesis } from "../../services/scoring/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const researchRoute = new Hono();

researchRoute.post(
	"/thesis",
	describeRoute({
		tags: ["Research"],
		summary: "Build a market thesis from sold comps + (optional) active asks",
		description:
			"Computes mean / median / IQR / sales-per-day from the comp cohort (IQR-cleaned). When the asks array is supplied, populates the asks-side stats too. When at least one comp carries duration data (lazily warmed by detail fetches against /v1/listings/:id), `meanDaysToSell` populates and `listPriceAdvice` becomes non-null. Pass the same `comps` array as you would to `/v1/evaluate` — same cohort means consistent stats across calls.",
		responses: {
			200: jsonResponse("Market thesis.", ResearchThesisResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(ResearchThesisRequest),
	async (c) => {
		const { comps, asks, context } = c.req.valid("json");
		const result = thesis(comps, asks, context);
		return c.json(result);
	},
);
