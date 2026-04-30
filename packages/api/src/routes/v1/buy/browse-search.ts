/**
 * GET /buy/browse/v1/item_summary/search
 *
 * eBay-compatible. Returns the same `SearchPagedCollection` envelope eBay's
 * Browse API returns — `itemSummaries[]`, `total`, etc. Caller can point
 * any eBay SDK at api.flipagent.dev and have it work transparently.
 *
 * The transport (REST / scrape / bridge) is selected via
 * `EBAY_LISTINGS_SOURCE`. The route is paper-thin — input validation,
 * source dispatch, response headers — and delegates everything else
 * (cache, observation archive, demand-pulse) to
 * `services/listings/search.ts`.
 */

import { BrowseSearchQuery, BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../../middleware/auth.js";
import { ListingsError } from "../../../services/listings/errors.js";
import { searchActiveListings } from "../../../services/listings/search.js";
import { renderResultHeaders } from "../../../services/shared/headers.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../../utils/openapi.js";

export const ebaySearchRoute = new Hono();

ebaySearchRoute.get(
	"/",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Search active listings",
		description:
			"Mirror of eBay's Browse `item_summary/search`. Returns the same `SearchPagedCollection` envelope with `itemSummaries[]`. Transport is selected via `EBAY_LISTINGS_SOURCE` (rest | scrape | bridge); the response shape is identical regardless.",
		parameters: paramsFor("query", BrowseSearchQuery),
		responses: {
			200: jsonResponse("SearchPagedCollection envelope.", BrowseSearchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream eBay or bridge transport failed."),
			503: errorResponse("EBAY_LISTINGS_SOURCE not configured."),
		},
	}),
	requireApiKey,
	tbCoerce("query", BrowseSearchQuery),
	async (c) => {
		const query = c.req.valid("query");
		try {
			const result = await searchActiveListings(
				{
					q: query.q,
					limit: query.limit,
					offset: query.offset,
					filter: query.filter,
					sort: query.sort,
					categoryIds: query.category_ids,
				},
				{
					apiKey: c.var.apiKey,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
					acceptLanguage: c.req.header("Accept-Language"),
				},
			);
			renderResultHeaders(c, result);
			return c.json(result.body);
		} catch (err) {
			if (err instanceof ListingsError) {
				const body = err.body ?? { error: err.code, message: err.message };
				return c.json(body as { error: string; message: string }, err.status as 400 | 404 | 412 | 502 | 503 | 504);
			}
			throw err;
		}
	},
);
