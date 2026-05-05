/**
 * `client.listings.*` — my for-sale stock (sell-side, write).
 * Wraps `/v1/listings/*` — one-shot create compresses eBay's three-step
 * inventory_item → offer → publish dance.
 */

import type {
	BulkInventoryGet,
	BulkOfferGet,
	ItemGroupActionRequest,
	ItemGroupPublishResponse,
	Listing,
	ListingBulkPriceUpdate,
	ListingBulkPublish,
	ListingBulkResult,
	ListingBulkUpsert,
	ListingCreate,
	ListingDraftRequest,
	ListingDraftResponse,
	ListingMigrate,
	ListingMigrateResult,
	ListingPreviewFeesRequest,
	ListingPreviewFeesResponse,
	ListingsListQuery,
	ListingsListResponse,
	ListingUpdate,
	ListingVerifyRequest,
	ListingVerifyResponse,
	ProductCompatibilityRequest,
	ProductCompatibilityResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ListingsClient {
	create(body: ListingCreate): Promise<Listing>;
	createDraft(body: ListingDraftRequest): Promise<ListingDraftResponse>;
	list(params?: ListingsListQuery): Promise<ListingsListResponse>;
	get(sku: string): Promise<Listing>;
	update(sku: string, patch: ListingUpdate): Promise<Listing>;
	end(sku: string): Promise<Listing>;
	relist(sku: string): Promise<Listing>;
	previewFees(body: ListingPreviewFeesRequest): Promise<ListingPreviewFeesResponse>;
	verify(body: ListingVerifyRequest): Promise<ListingVerifyResponse>;
	publishGroup(body: ItemGroupActionRequest): Promise<ItemGroupPublishResponse>;
	withdrawGroup(body: ItemGroupActionRequest): Promise<{ ok: true }>;
	bulkGetInventory(body: BulkInventoryGet): Promise<unknown>;
	bulkGetOffers(body: BulkOfferGet): Promise<unknown>;
	bulkUpdatePrices(body: ListingBulkPriceUpdate): Promise<ListingBulkResult>;
	bulkUpsert(body: ListingBulkUpsert): Promise<ListingBulkResult>;
	bulkPublish(body: ListingBulkPublish): Promise<ListingBulkResult>;
	migrate(body: ListingMigrate): Promise<ListingMigrateResult>;
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
		createDraft: (body) => http.post("/v1/listings/draft", body),
		list: (params) => http.get("/v1/listings", params as Record<string, string | number | undefined> | undefined),
		get: (sku) => http.get(`/v1/listings/${encodeURIComponent(sku)}`),
		update: (sku, patch) => http.patch(`/v1/listings/${encodeURIComponent(sku)}`, patch),
		end: (sku) => http.delete(`/v1/listings/${encodeURIComponent(sku)}`),
		relist: (sku) => http.post(`/v1/listings/${encodeURIComponent(sku)}/relist`),
		previewFees: (body) => http.post("/v1/listings/preview-fees", body),
		verify: (body) => http.post("/v1/listings/verify", body),
		publishGroup: (body) =>
			http.post(`/v1/listings/groups/${encodeURIComponent(body.inventoryItemGroupKey)}/publish`, body),
		withdrawGroup: (body) =>
			http.post(`/v1/listings/groups/${encodeURIComponent(body.inventoryItemGroupKey)}/withdraw`, body),
		bulkGetInventory: (body) => http.post("/v1/listings/bulk/get-inventory", body),
		bulkGetOffers: (body) => http.post("/v1/listings/bulk/get-offers", body),
		bulkUpdatePrices: (body) => http.post("/v1/listings/bulk/price", body),
		bulkUpsert: (body) => http.post("/v1/listings/bulk/upsert", body),
		bulkPublish: (body) => http.post("/v1/listings/bulk/publish", body),
		migrate: (body) => http.post("/v1/listings/bulk/migrate", body),
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
