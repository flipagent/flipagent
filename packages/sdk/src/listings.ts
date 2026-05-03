/**
 * `client.listings.*` — my for-sale stock (sell-side, write).
 * Wraps `/v1/listings/*` — one-shot create compresses eBay's three-step
 * inventory_item → offer → publish dance.
 */

import type {
	ItemGroupActionRequest,
	ItemGroupPublishResponse,
	Listing,
	ListingCreate,
	ListingPreviewFeesRequest,
	ListingPreviewFeesResponse,
	ListingsListQuery,
	ListingsListResponse,
	ListingUpdate,
	ProductCompatibilityRequest,
	ProductCompatibilityResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ListingsClient {
	create(body: ListingCreate): Promise<Listing>;
	list(params?: ListingsListQuery): Promise<ListingsListResponse>;
	get(sku: string): Promise<Listing>;
	update(sku: string, patch: ListingUpdate): Promise<Listing>;
	end(sku: string): Promise<Listing>;
	relist(sku: string): Promise<Listing>;
	previewFees(body: ListingPreviewFeesRequest): Promise<ListingPreviewFeesResponse>;
	publishGroup(body: ItemGroupActionRequest): Promise<ItemGroupPublishResponse>;
	withdrawGroup(body: ItemGroupActionRequest): Promise<{ ok: true }>;
	getCompatibility(sku: string): Promise<ProductCompatibilityResponse>;
	setCompatibility(sku: string, body: ProductCompatibilityRequest): Promise<{ ok: true }>;
	deleteCompatibility(sku: string): Promise<void>;
	getSkuLocations(listingId: string, sku: string): Promise<import("@flipagent/types").SkuLocationsResponse>;
	setSkuLocations(
		listingId: string,
		sku: string,
		body: import("@flipagent/types").SkuLocationsRequest,
	): Promise<{ ok: true }>;
	deleteSkuLocations(listingId: string, sku: string): Promise<void>;
}

export function createListingsClient(http: FlipagentHttp): ListingsClient {
	return {
		create: (body) => http.post("/v1/listings", body),
		list: (params) => http.get("/v1/listings", params as Record<string, string | number | undefined> | undefined),
		get: (sku) => http.get(`/v1/listings/${encodeURIComponent(sku)}`),
		update: (sku, patch) => http.patch(`/v1/listings/${encodeURIComponent(sku)}`, patch),
		end: (sku) => http.delete(`/v1/listings/${encodeURIComponent(sku)}`),
		relist: (sku) => http.post(`/v1/listings/${encodeURIComponent(sku)}/relist`),
		previewFees: (body) => http.post("/v1/listings/preview-fees", body),
		publishGroup: (body) =>
			http.post(`/v1/listings/groups/${encodeURIComponent(body.inventoryItemGroupKey)}/publish`, body),
		withdrawGroup: (body) =>
			http.post(`/v1/listings/groups/${encodeURIComponent(body.inventoryItemGroupKey)}/withdraw`, body),
		getCompatibility: (sku) => http.get(`/v1/listings/${encodeURIComponent(sku)}/compatibility`),
		setCompatibility: (sku, body) => http.put(`/v1/listings/${encodeURIComponent(sku)}/compatibility`, body),
		deleteCompatibility: (sku) => http.delete(`/v1/listings/${encodeURIComponent(sku)}/compatibility`),
		getSkuLocations: (listingId, sku) =>
			http.get(`/v1/listings/${encodeURIComponent(listingId)}/skus/${encodeURIComponent(sku)}/locations`),
		setSkuLocations: (listingId, sku, body) =>
			http.put(`/v1/listings/${encodeURIComponent(listingId)}/skus/${encodeURIComponent(sku)}/locations`, body),
		deleteSkuLocations: (listingId, sku) =>
			http.delete(`/v1/listings/${encodeURIComponent(listingId)}/skus/${encodeURIComponent(sku)}/locations`),
	};
}
