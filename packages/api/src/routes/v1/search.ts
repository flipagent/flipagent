/**
 * GET /v1/search
 *
 * flipagent-side ergonomic search. Dispatches by `mode`:
 *   - `active` (default) → eBay Browse `item_summary/search`
 *   - `sold`             → Marketplace Insights `item_sales/search`
 *
 * Response is the eBay `SearchPagedCollection` envelope as-is —
 * `itemSummaries[]` for active, `itemSales[]` for sold. Same envelope
 * shape the two mirror routes return; this is the unified entrypoint
 * with one fewer URL to remember.
 *
 * Mirror routes (`/v1/buy/browse/item_summary/search`,
 * `/v1/buy/marketplace_insights/item_sales/search`) stay first-class
 * for callers that want the eBay 1:1 path mapping.
 *
 * Route is paper-thin — input validation + headers — everything else
 * (cache, transport selection, observation archive, demand-pulse)
 * lives in `services/listings/{search,sold}.ts` via the
 * `services/search/` dispatcher.
 */

import { SearchQuery, SearchResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { ListingsError } from "../../services/listings/errors.js";
import { search } from "../../services/search/index.js";
import { renderResultHeaders } from "../../services/shared/headers.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const searchRoute = new Hono();

searchRoute.get(
	"/",
	describeRoute({
		tags: ["flipagent"],
		summary: "Search active or sold listings",
		description:
			"Unified entrypoint over eBay Browse (active) and Marketplace Insights (sold). Pass `mode=active` (default) or `mode=sold`. Response mirrors the eBay `SearchPagedCollection` envelope — `itemSummaries[]` for active, `itemSales[]` for sold. Both share the same `ItemSummary` shape. Transport (rest / scrape / bridge) is picked by the same env knobs as the underlying mirror routes.",
		parameters: paramsFor("query", SearchQuery),
		responses: {
			200: jsonResponse("SearchPagedCollection envelope.", SearchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream eBay or bridge transport failed."),
			503: errorResponse("Required source not configured (e.g. mode=sold without EBAY_INSIGHTS_APPROVED)."),
		},
	}),
	requireApiKey,
	tbCoerce("query", SearchQuery),
	async (c) => {
		const query = c.req.valid("query");
		try {
			const result = await search(
				{
					q: query.q,
					mode: query.mode,
					limit: query.limit,
					offset: query.offset,
					filter: query.filter,
					sort: query.sort,
					categoryIds: query.category_ids,
					aspectFilter: query.aspect_filter,
					gtin: query.gtin,
					epid: query.epid,
					fieldgroups: query.fieldgroups,
					autoCorrect: query.auto_correct,
					compatibilityFilter: query.compatibility_filter,
					charityIds: query.charity_ids,
				},
				{
					apiKey: c.var.apiKey,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
					acceptLanguage: c.req.header("Accept-Language"),
				},
			);
			renderResultHeaders(c, result);
			// Spread `source` (and the cache flavour) into the body so SDK
			// callers that don't peek at headers — and the playground —
			// can render the transport pill from a single shape. Headers
			// remain authoritative; this is a convenience overlay.
			return c.json({
				...result.body,
				source: result.fromCache ? `cache:${result.source}` : result.source,
			});
		} catch (err) {
			if (err instanceof ListingsError) {
				const body = err.body ?? { error: err.code, message: err.message };
				return c.json(body as { error: string; message: string }, err.status as 400 | 404 | 412 | 502 | 503 | 504);
			}
			throw err;
		}
	},
);
