/**
 * Listing lifecycle ops on top of the existing inventory_item + offer
 * pair: end (withdraw + delete), update (PATCH-style), relist
 * (re-publish a draft / withdrawn offer).
 *
 * `id` is always the SKU. eBay's offerId / listingId are looked up
 * from `getListing` since the caller doesn't see them.
 */

import type { Listing, ListingUpdate } from "@flipagent/types";
import { EbayApiError, sellRequest } from "../ebay/rest/user-client.js";
import { type GetListingContext, getListing } from "./get.js";
import { listingUpdateToEbay } from "./transform.js";

export interface LifecycleContext extends GetListingContext {}

/**
 * End the listing — withdraw the offer (if active) and delete the
 * inventory item. Returns the final `Listing` shape with `status='withdrawn'`.
 */
export async function endListing(sku: string, ctx: LifecycleContext): Promise<Listing | null> {
	const current = await getListing(sku, ctx);
	if (!current) return null;
	if (current.offerId) {
		await sellRequest({
			apiKeyId: ctx.apiKeyId,
			method: "POST",
			path: `/sell/inventory/v1/offer/${encodeURIComponent(current.offerId)}/withdraw`,
			body: {},
			marketplace: ctx.marketplace,
		}).catch((err) => {
			// `409 already_withdrawn` and `404 not_found` are non-fatal.
			if (err instanceof EbayApiError && (err.status === 404 || err.status === 409)) return;
			throw err;
		});
	}
	// Delete the inventory item once the offer is withdrawn.
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
		marketplace: ctx.marketplace,
	}).catch((err) => {
		if (err instanceof EbayApiError && err.status === 404) return;
		throw err;
	});
	return { ...current, status: "withdrawn" };
}

/**
 * Patch a listing in place. Inventory-item fields PUT (full replace,
 * eBay semantics); offer fields PUT-update.
 */
export async function updateListing(sku: string, patch: ListingUpdate, ctx: LifecycleContext): Promise<Listing | null> {
	const current = await getListing(sku, ctx);
	if (!current) return null;
	const payloads = listingUpdateToEbay(patch, {
		sku,
		condition: current.condition,
		quantity: current.quantity,
	});
	if (payloads.inventoryItem) {
		// Title is required on PUT; merge in the current title if the patch
		// didn't include one. Aspects/images merge field-by-field.
		const product = payloads.inventoryItem.product ?? { title: current.title };
		if (!product.title) product.title = current.title;
		if (!product.imageUrls && current.images.length > 0) product.imageUrls = current.images;
		if (!product.aspects && current.aspects) product.aspects = current.aspects;
		if (!product.description && current.description !== undefined) product.description = current.description;
		payloads.inventoryItem.product = product;
		await sellRequest({
			apiKeyId: ctx.apiKeyId,
			method: "PUT",
			path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
			body: payloads.inventoryItem,
			marketplace: ctx.marketplace,
			contentLanguage: "en-US",
		});
	}
	if (payloads.offer && current.offerId) {
		await sellRequest({
			apiKeyId: ctx.apiKeyId,
			method: "PUT",
			path: `/sell/inventory/v1/offer/${encodeURIComponent(current.offerId)}`,
			body: payloads.offer,
			marketplace: ctx.marketplace,
			contentLanguage: "en-US",
		});
	}
	return getListing(sku, ctx);
}

/**
 * Re-publish an existing offer. Used after a publish-step failure or
 * after `endListing` if the offer is still around (rare).
 */
export async function relistListing(sku: string, ctx: LifecycleContext): Promise<Listing | null> {
	const current = await getListing(sku, ctx);
	if (!current) return null;
	if (!current.offerId) return current;
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/inventory/v1/offer/${encodeURIComponent(current.offerId)}/publish`,
		body: {},
		marketplace: ctx.marketplace,
	});
	return getListing(sku, ctx);
}
