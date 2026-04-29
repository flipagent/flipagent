/**
 * `/v1/discover/*` — multi-item ranking. "Show me the deals across this
 * search."
 *
 *   POST /v1/discover           — rank a Browse search response
 *   (future: GET /v1/discover/scan — watchlist queue for scheduled discovery)
 *
 * Maps to the Overnight pillar on the marketing site (#03: scan while
 * you sleep, wake to a ranked queue).
 */

import { DiscoverRequest, DiscoverResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { discoverDeals } from "../../services/evaluate/discover-deals.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const discoverRoute = new Hono();

discoverRoute.post(
	"/",
	describeRoute({
		tags: ["Discover"],
		summary: "Rank deals across a Browse search response",
		description:
			"Maps `evaluate` over `results.itemSummaries` (or `results.itemSales` for sold searches), filters out items without a profitable `recommendedExit`, and sorts by `recommendedExit.dollarsPerDay` (capital efficiency). Same `opts` semantics as `/v1/evaluate`. Capped at 200 items per call (matches eBay Browse's max page size).",
		responses: {
			200: jsonResponse("Ranked deals.", DiscoverResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(DiscoverRequest),
	async (c) => {
		const { results, opts } = c.req.valid("json");
		const itemCount = (results.itemSummaries?.length ?? 0) + (results.itemSales?.length ?? 0);
		if (itemCount > 200) {
			return c.json(
				{
					error: "validation_failed" as const,
					message: `Too many items: got ${itemCount}, max 200 per call. Page through the search and call /v1/discover per page.`,
				},
				400,
			);
		}
		const deals = await discoverDeals(results, opts);
		return c.json({ deals });
	},
);
