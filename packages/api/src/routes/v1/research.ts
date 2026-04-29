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

import { RecoveryRequest, RecoveryResponse, ResearchThesisRequest, ResearchThesisResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { recoveryProbability } from "../../services/quant/index.js";
import { marketFromComps } from "../../services/scoring/adapter.js";
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

researchRoute.post(
	"/recovery_probability",
	describeRoute({
		tags: ["Research"],
		summary: "Probability of recovering cost basis + min net within a time window",
		description:
			"Composes the same hazard model as `optimalListPrice` with a fee schedule to answer: 'If I buy at `costBasisCents`, what's the probability of selling at the price needed to clear cost + `minNetCents` within `withinDays`?' Confidence reflects the duration sample size (n ≥ 10 high, n ≥ 5 medium, otherwise low or none).",
		responses: {
			200: jsonResponse("Recovery probability.", RecoveryResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(RecoveryRequest),
	async (c) => {
		const { comps, costBasisCents, withinDays, minNetCents, outboundShippingCents, context } = c.req.valid("json");
		const market = marketFromComps(comps, context ?? {}, undefined, undefined);
		const result = recoveryProbability({
			market,
			costBasisCents,
			withinDays,
			minNetCents,
			outboundShippingCents,
		});
		return c.json(result);
	},
);
