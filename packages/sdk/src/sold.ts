/**
 * `client.sold.*` — sold-listing search (last 90 days). Server-side
 * caches so repeated calls within the cache TTL hit the same upstream
 * once.
 */

import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import type { FlipagentHttp } from "./http.js";

export interface SoldSearchParams {
	q: string;
	filter?: string;
	/** Marketplace Insights ignores `sort` — kept for parity, dropped at the route. */
	sort?: string;
	limit?: number;
	offset?: number;
	category_ids?: string;
	marketplace?: string;
	/**
	 * eBay-spec optional params Marketplace Insights supports. eBay's
	 * spec excludes `sort`, `auto_correct`, `compatibility_filter`, and
	 * `charity_ids` for sold; we mirror that.
	 */
	aspect_filter?: string;
	gtin?: string;
	epid?: string;
	fieldgroups?: string;
}

export interface SoldClient {
	search(params: SoldSearchParams): Promise<BrowseSearchResponse>;
}

export function createSoldClient(http: FlipagentHttp): SoldClient {
	return {
		search: (params) => http.get("/v1/buy/marketplace_insights/item_sales/search", { ...params }),
	};
}
