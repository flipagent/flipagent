/**
 * `/v1/search` schema — unified entrypoint over the two eBay-mirror
 * search endpoints. Dispatches by `mode`:
 *   - "active" (default) → /v1/buy/browse/item_summary/search
 *   - "sold"             → /v1/buy/marketplace_insights/item_sales/search
 *
 * Reuses eBay-shape `BrowseSearchQuery` verbatim and just adds `mode`.
 * Response is the eBay-shape `BrowseSearchResponse` (already carries
 * both `itemSummaries` and `itemSales`) — no new normalization layer.
 *
 * Mirror routes stay first-class for callers that want the eBay 1:1
 * mapping; this is the ergonomic shortcut.
 */

import { type Static, Type } from "@sinclair/typebox";
import { BrowseSearchQuery, BrowseSearchResponse } from "./ebay/buy.js";

export const SearchMode = Type.Union([Type.Literal("active"), Type.Literal("sold")], { $id: "SearchMode" });
export type SearchMode = Static<typeof SearchMode>;

/**
 * GET /v1/search query params. Same shape as `BrowseSearchQuery` plus
 * a `mode` discriminator. `sort` only applies to `mode=active` —
 * Marketplace Insights doesn't expose a sort axis. The sold service
 * silently ignores `sort` rather than 400'ing on it.
 *
 * Composed via `Type.Composite` (not `Type.Intersect`) so the result
 * stays a `TObject` — `paramsFor` reads `.properties` to expand it
 * into OpenAPI query parameters.
 */
export const SearchQuery = Type.Composite(
	[
		BrowseSearchQuery,
		Type.Object({
			mode: Type.Optional(SearchMode),
		}),
	],
	{ $id: "SearchQuery" },
);
export type SearchQuery = Static<typeof SearchQuery>;

/**
 * `/v1/search` response — the eBay `SearchPagedCollection` envelope.
 * Active mode populates `itemSummaries[]`; sold mode populates
 * `itemSales[]`. Both share the same `ItemSummary` shape.
 */
export const SearchResponse = BrowseSearchResponse;
export type SearchResponse = BrowseSearchResponse;
