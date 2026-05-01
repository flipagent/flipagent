/**
 * GET /buy/marketplace_insights/v1_beta/item_sales/search
 *
 * eBay-compatible. Returns `itemSales[]` (Marketplace Insights field name).
 * Same envelope shape as the active-listing search.
 *
 * Transport selected by `EBAY_SOLD_SOURCE` (rest | scrape | bridge) — explicit
 * per-request, no fallback. REST path requires `EBAY_INSIGHTS_APPROVED=1`;
 * the listings/sold service surfaces a 503 when the gate is missing.
 *
 * Route is paper-thin — input validation + headers — everything else
 * (cache, observation archive, demand-pulse) lives in
 * `services/listings/sold.ts`.
 */

import { BrowseSearchResponse, SoldSearchQuery } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../../middleware/auth.js";
import { ListingsError } from "../../../services/listings/errors.js";
import { searchSoldListings } from "../../../services/listings/sold.js";
import { renderResultHeaders } from "../../../services/shared/headers.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../../utils/openapi.js";

export const ebaySoldSearchRoute = new Hono();

ebaySoldSearchRoute.get(
	"/",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Recently-sold listings",
		description:
			"Mirror of Marketplace Insights `item_sales/search`. Transport selected via `EBAY_SOLD_SOURCE` (rest | scrape | bridge). REST path requires `EBAY_INSIGHTS_APPROVED=1`; otherwise returns 503.",
		parameters: paramsFor("query", SoldSearchQuery),
		responses: {
			200: jsonResponse("Marketplace Insights envelope.", BrowseSearchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream eBay or bridge transport failed."),
			503: errorResponse("EBAY_SOLD_SOURCE not configured (or rest selected without Insights approval)."),
		},
	}),
	requireApiKey,
	tbCoerce("query", SoldSearchQuery),
	async (c) => {
		const query = c.req.valid("query");
		try {
			const result = await searchSoldListings(
				{
					q: query.q,
					limit: query.limit,
					offset: query.offset,
					filter: query.filter,
					categoryIds: query.category_ids,
					aspectFilter: query.aspect_filter,
					gtin: query.gtin,
					epid: query.epid,
					fieldgroups: query.fieldgroups,
				},
				{
					apiKey: c.var.apiKey,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
					acceptLanguage: c.req.header("Accept-Language"),
				},
			);
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source });
		} catch (err) {
			if (err instanceof ListingsError) {
				const body = err.body ?? { error: err.code, message: err.message };
				return c.json(body as { error: string; message: string }, err.status as 400 | 404 | 412 | 502 | 503 | 504);
			}
			throw err;
		}
	},
);
