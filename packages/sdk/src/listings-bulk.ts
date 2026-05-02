/**
 * `client.listingsBulk.*` — multi-SKU bulk operations on top of
 * `client.listings.*`. All endpoints are POST with batched payloads.
 */

import type {
	BulkInventoryGet,
	BulkOfferGet,
	ListingBulkPriceUpdate,
	ListingBulkPublish,
	ListingBulkResult,
	ListingBulkUpsert,
	ListingMigrate,
	ListingMigrateResult,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ListingsBulkClient {
	getInventory(body: BulkInventoryGet): Promise<unknown>;
	getOffers(body: BulkOfferGet): Promise<unknown>;
	updatePrices(body: ListingBulkPriceUpdate): Promise<ListingBulkResult>;
	upsert(body: ListingBulkUpsert): Promise<ListingBulkResult>;
	publish(body: ListingBulkPublish): Promise<ListingBulkResult>;
	migrate(body: ListingMigrate): Promise<ListingMigrateResult>;
}

export function createListingsBulkClient(http: FlipagentHttp): ListingsBulkClient {
	return {
		getInventory: (body) => http.post("/v1/listings/bulk/get-inventory", body),
		getOffers: (body) => http.post("/v1/listings/bulk/get-offers", body),
		updatePrices: (body) => http.post("/v1/listings/bulk/price", body),
		upsert: (body) => http.post("/v1/listings/bulk/upsert", body),
		publish: (body) => http.post("/v1/listings/bulk/publish", body),
		migrate: (body) => http.post("/v1/listings/bulk/migrate", body),
	};
}
