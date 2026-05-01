/**
 * `client.search.*` — unified entrypoint over the active / sold
 * mirrors. Pass `mode: "active"` (default) or `mode: "sold"`. Returns
 * the eBay `SearchPagedCollection` envelope — `itemSummaries[]` for
 * active, `itemSales[]` for sold.
 *
 * `client.listings` and `client.sold` are still exposed for callers
 * that want the eBay 1:1 path mapping; this is the ergonomic shortcut
 * with one fewer URL to remember.
 */

import type { SearchMode } from "@flipagent/types";
import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import type { FlipagentHttp } from "./http.js";

export interface SearchParams {
	q: string;
	/** "active" (default) hits Browse; "sold" hits Marketplace Insights. */
	mode?: SearchMode;
	filter?: string;
	/** Honoured only when `mode === "active"`. Ignored for sold. */
	sort?: string;
	limit?: number;
	offset?: number;
	category_ids?: string;
	marketplace?: string;
	/**
	 * eBay-spec optional params. `aspect_filter` / `gtin` / `epid` /
	 * `fieldgroups` apply to both modes; the rest are active-only
	 * (sold ignores them per Marketplace Insights spec).
	 */
	aspect_filter?: string;
	gtin?: string;
	epid?: string;
	fieldgroups?: string;
	auto_correct?: string;
	compatibility_filter?: string;
	charity_ids?: string;
}

export type SearchClient = (params: SearchParams) => Promise<BrowseSearchResponse>;

export function createSearchClient(http: FlipagentHttp): SearchClient {
	return (params) => http.get("/v1/search", { ...params });
}
