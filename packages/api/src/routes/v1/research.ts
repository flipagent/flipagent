/**
 * `/v1/research/*` — market summary + recovery probability. The bundle
 * the agent computes once per SKU and reuses across `/v1/discover`,
 * `/v1/evaluate`, `/v1/draft`, `/v1/reprice`.
 *
 *   POST /v1/research/summary              — distribution + (optional) EV-optimal list price
 *   POST /v1/research/recovery_probability — P(recover cost basis within window)
 *
 * Maps to the Decisions pillar (#01) — the read-side feeder for every
 * intelligence call.
 */

import { MarketSummaryRequest, MarketSummaryResponse, RecoveryRequest, RecoveryResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { marketFromComparables } from "../../services/evaluate/adapter.js";
import { recoveryProbability } from "../../services/quant/index.js";
import { marketSummary } from "../../services/research/summary.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const researchRoute = new Hono();

researchRoute.post(
	"/summary",
	describeRoute({
		tags: ["Research"],
		summary: "Build a market summary from sold comparables + (optional) active asks",
		description:
			"Computes mean / median / IQR / sales-per-day from the comparable cohort (IQR-cleaned). When the asks array is supplied, populates the asks-side stats too. When at least one comparable carries duration data (lazily warmed by detail fetches against /v1/buy/browse/item/:itemId), `meanDaysToSell` populates and `listPriceRecommendation` becomes non-null. Pass the same `comparables` array as you would to `/v1/evaluate` — same cohort means consistent stats across calls.",
		responses: {
			200: jsonResponse("Market summary.", MarketSummaryResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(MarketSummaryRequest),
	async (c) => {
		const { comparables, asks, context } = c.req.valid("json");
		const result = marketSummary(comparables, asks, context);
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
		const { comparables, costBasisCents, withinDays, minNetCents, outboundShippingCents, context } =
			c.req.valid("json");
		const market = marketFromComparables(comparables, context ?? {}, undefined, undefined);
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
