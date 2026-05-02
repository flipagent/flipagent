/**
 * `client.listings.*` — my for-sale stock (sell-side, write).
 * Wraps `/v1/listings/*` — one-shot create compresses eBay's three-step
 * inventory_item → offer → publish dance.
 */

import type { Listing, ListingCreate, ListingsListQuery, ListingsListResponse, ListingUpdate } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ListingsClient {
	create(body: ListingCreate): Promise<Listing>;
	list(params?: ListingsListQuery): Promise<ListingsListResponse>;
	get(sku: string): Promise<Listing>;
	update(sku: string, patch: ListingUpdate): Promise<Listing>;
	end(sku: string): Promise<Listing>;
	relist(sku: string): Promise<Listing>;
}

export function createListingsClient(http: FlipagentHttp): ListingsClient {
	return {
		create: (body) => http.post("/v1/listings", body),
		list: (params) => http.get("/v1/listings", params as Record<string, string | number | undefined> | undefined),
		get: (sku) => http.get(`/v1/listings/${encodeURIComponent(sku)}`),
		update: (sku, patch) => http.patch(`/v1/listings/${encodeURIComponent(sku)}`, patch),
		end: (sku) => http.delete(`/v1/listings/${encodeURIComponent(sku)}`),
		relist: (sku) => http.post(`/v1/listings/${encodeURIComponent(sku)}/relist`),
	};
}
