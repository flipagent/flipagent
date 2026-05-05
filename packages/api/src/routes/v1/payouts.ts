/**
 * `/v1/payouts/*` — sell/finances payouts (list + summary).
 */

import { type PayoutSummary, PayoutsListQuery, PayoutsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getPayoutSummary, listPayouts } from "../../services/money/operations.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const payoutsRoute = new Hono();

const COMMON = {
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset."),
};

payoutsRoute.get(
	"/summary",
	describeRoute({
		tags: ["Money"],
		summary: "Payout aggregate over a date range",
		responses: { 200: { description: "Summary." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const from = c.req.query("from") ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
		return c.json({
			...(await getPayoutSummary(from, to, {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
			source: "rest" as const,
		} satisfies PayoutSummary);
	},
);

payoutsRoute.get(
	"/",
	describeRoute({
		tags: ["Money"],
		summary: "List payouts",
		parameters: paramsFor("query", PayoutsListQuery),
		responses: { 200: jsonResponse("Payouts page.", PayoutsListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", PayoutsListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listPayouts(q, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({
			payouts: r.payouts,
			limit: r.limit,
			offset: r.offset,
			...(r.total !== undefined ? { total: r.total } : {}),
			source: "rest" as const,
		} satisfies PayoutsListResponse);
	},
);
