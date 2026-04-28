/**
 * `client.inventory.*` — seller-side write (user OAuth required).
 * Server proxies to eBay's Sell Inventory API; payloads are eBay-shape.
 * Future marketplaces normalize their write APIs into the same shape.
 */

import type { FlipagentHttp } from "./http.js";

export interface InventoryClient {
	getItem(sku: string): Promise<unknown>;
	putItem(sku: string, body: unknown): Promise<unknown>;
	deleteItem(sku: string): Promise<unknown>;
	createOffer(body: unknown): Promise<unknown>;
	getOffer(offerId: string): Promise<unknown>;
	updateOffer(offerId: string, body: unknown): Promise<unknown>;
	deleteOffer(offerId: string): Promise<unknown>;
	publishOffer(offerId: string): Promise<unknown>;
	createLocation(merchantLocationKey: string, body: unknown): Promise<unknown>;
}

export function createInventoryClient(http: FlipagentHttp): InventoryClient {
	return {
		getItem: (sku) => http.get(`/v1/inventory/inventory_item/${encodeURIComponent(sku)}`),
		putItem: (sku, body) => http.put(`/v1/inventory/inventory_item/${encodeURIComponent(sku)}`, body),
		deleteItem: (sku) => http.delete(`/v1/inventory/inventory_item/${encodeURIComponent(sku)}`),
		createOffer: (body) => http.post("/v1/inventory/offer", body),
		getOffer: (offerId) => http.get(`/v1/inventory/offer/${encodeURIComponent(offerId)}`),
		updateOffer: (offerId, body) => http.put(`/v1/inventory/offer/${encodeURIComponent(offerId)}`, body),
		deleteOffer: (offerId) => http.delete(`/v1/inventory/offer/${encodeURIComponent(offerId)}`),
		publishOffer: (offerId) => http.post(`/v1/inventory/offer/${encodeURIComponent(offerId)}/publish`),
		createLocation: (key, body) => http.post(`/v1/inventory/location/${encodeURIComponent(key)}`, body),
	};
}
