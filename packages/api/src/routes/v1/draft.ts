/**
 * `/v1/draft` — recommend an optimal listing for an item the seller is
 * about to (re)list. Pure compute over `market` (from
 * `/v1/research/summary`). Returns `listPriceRecommendation` + a title to use.
 *
 * Maps to the Operations pillar (#02) — the sell-side counterpart to
 * `/v1/evaluate` (buy-side).
 */

import { DraftRequest, DraftResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { draft } from "../../services/draft/draft.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const draftRoute = new Hono();

draftRoute.post(
	"/",
	describeRoute({
		tags: ["Draft"],
		summary: "Recommend optimal list price + title for a (re)listing",
		description:
			"Wraps `optimalListPrice` over the supplied market summary. Returns `listPriceRecommendation: null` (with a `reason` like 'no time-to-sell data') when the market has no `meanDaysToSell` — caller should fall back to listing at `market.medianCents`. Title passes through verbatim from the input item; a future title rewriter slots in here.",
		responses: {
			200: jsonResponse("Listing draft recommendation.", DraftResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(DraftRequest),
	async (c) => {
		const { item, market, outboundShippingCents } = c.req.valid("json");
		const rec = draft(item, market, { outboundShippingCents });
		return c.json(rec);
	},
);
