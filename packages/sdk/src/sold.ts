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
	sort?: string;
	limit?: number;
	offset?: number;
	category_ids?: string;
	marketplace?: string;
}

export interface SoldClient {
	search(params: SoldSearchParams): Promise<BrowseSearchResponse>;
}

export function createSoldClient(http: FlipagentHttp): SoldClient {
	return {
		search: (params) => http.get("/v1/buy/marketplace_insights/item_sales/search", { ...params }),
	};
}
