/**
 * `client.listings.*` — search and detail lookups across the unified
 * marketplace surface. Today: eBay only. Future Amazon / Mercari
 * adapters reuse the same paths with a `marketplace` parameter.
 */

import type { BrowseSearchResponse, ItemDetail } from "@flipagent/types/ebay/buy";
import type { FlipagentHttp } from "./http.js";

export interface ListingSearchParams {
	q: string;
	filter?: string;
	sort?: string;
	limit?: number;
	offset?: number;
	category_ids?: string;
	marketplace?: string;
}

export interface ListingsClient {
	search(params: ListingSearchParams): Promise<BrowseSearchResponse>;
	get(itemId: string, fieldgroups?: string): Promise<ItemDetail>;
	byIds(itemIds: string[], fieldgroups?: string): Promise<{ items?: ItemDetail[] }>;
	byGroup(itemGroupId: string): Promise<{ items?: ItemDetail[] }>;
}

export function createListingsClient(http: FlipagentHttp): ListingsClient {
	return {
		search: (params) => http.get("/v1/listings/search", { ...params }),
		get: (itemId, fieldgroups) =>
			http.get(`/v1/listings/${encodeURIComponent(itemId)}`, fieldgroups ? { fieldgroups } : undefined),
		byIds: (itemIds, fieldgroups) => http.get("/v1/listings/get_items", { item_ids: itemIds.join(","), fieldgroups }),
		byGroup: (itemGroupId) => http.get("/v1/listings/get_items_by_item_group", { item_group_id: itemGroupId }),
	};
}
