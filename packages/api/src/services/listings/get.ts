/**
 * `GET /v1/listings/{id}` + `GET /v1/listings` orchestrators.
 *
 * eBay splits the listing surface across two resources: `inventory_item`
 * (stock state) and `offer` (commercial state). Neither alone gives a
 * complete `Listing`, so reads merge both. `id` here is the SKU — the
 * stable handle across all of inventory_item, offer, and the live
 * listing id.
 */

import type { Listing } from "@flipagent/types";
import type { InventoryItem, OfferDetails } from "@flipagent/types/ebay/sell";
import { EbayApiError, sellRequest } from "../ebay/rest/user-client.js";
import { ebayToListing } from "./transform.js";

interface OffersListResponse {
	offers?: Array<
		Partial<OfferDetails> & {
			offerId?: string;
			listing?: { listingId?: string };
			status?: string;
		}
	>;
}

interface InventoryItemsListResponse {
	inventoryItems?: Array<InventoryItem & { sku: string; locale?: string }>;
	total?: number;
	limit?: number;
	offset?: number;
}

export interface GetListingContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function getListing(sku: string, ctx: GetListingContext): Promise<Listing | null> {
	const item = await sellRequest<InventoryItem>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
		marketplace: ctx.marketplace,
	}).catch((err) => {
		if (err instanceof EbayApiError && err.status === 404) return null;
		throw err;
	});
	if (!item) return null;

	const offersRes = await sellRequest<OffersListResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
		marketplace: ctx.marketplace,
	}).catch((err) => {
		// 404 on offers is fine — the inventory item exists without an offer yet.
		if (err instanceof EbayApiError && err.status === 404) return null;
		throw err;
	});
	const offer = offersRes?.offers?.[0];
	return ebayToListing({ sku, inventoryItem: item, offer });
}

export interface ListListingsInput {
	limit?: number;
	offset?: number;
}

export interface ListListingsResult {
	listings: Listing[];
	limit: number;
	offset: number;
	total?: number;
}

export async function listListings(input: ListListingsInput, ctx: GetListingContext): Promise<ListListingsResult> {
	const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
	const offset = Math.max(input.offset ?? 0, 0);

	const itemsRes = await sellRequest<InventoryItemsListResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
		marketplace: ctx.marketplace,
	});
	const items = itemsRes?.inventoryItems ?? [];
	if (items.length === 0) {
		return { listings: [], limit, offset, total: itemsRes?.total ?? 0 };
	}

	// Fetch offers in parallel — eBay's getOffers is per-SKU.
	const offers = await Promise.all(
		items.map((item) =>
			sellRequest<OffersListResponse>({
				apiKeyId: ctx.apiKeyId,
				method: "GET",
				path: `/sell/inventory/v1/offer?sku=${encodeURIComponent(item.sku)}`,
				marketplace: ctx.marketplace,
			}).catch((err) => {
				if (err instanceof EbayApiError && err.status === 404) return null;
				throw err;
			}),
		),
	);

	const listings = items.map((item, idx) =>
		ebayToListing({
			sku: item.sku,
			inventoryItem: item,
			offer: offers[idx]?.offers?.[0],
		}),
	);

	return {
		listings,
		limit,
		offset,
		...(itemsRes?.total !== undefined ? { total: itemsRes.total } : {}),
	};
}
