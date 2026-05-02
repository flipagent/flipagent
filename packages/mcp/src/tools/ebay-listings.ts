/**
 * Sell-side listing tools — backed by `/v1/listings/*` (one-shot
 * create compresses eBay's inventory_item → offer → publish flow).
 * Caller must have connected eBay via /v1/connect/ebay.
 */

import { ListingCreate, ListingUpdate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayCreateInventoryItemInput = ListingCreate;

export const ebayCreateInventoryItemDescription =
	"List a new item for sale (one-shot). POST /v1/listings — flipagent compresses eBay's inventory_item → offer → publish. Returns the live `Listing` with `id` (eBay listingId), `sku`, `status='active'`. Required: title, price (cents-int), condition, categoryId, images, policies (fulfillment/payment/return ids), merchantLocationKey.";

export async function ebayCreateInventoryItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.create(args as unknown as Parameters<typeof client.listings.create>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings");
		return { error: "listings_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayCreateOfferInput = Type.Composite([
	Type.Object({ sku: Type.String({ description: "SKU returned from create-listing." }) }),
	ListingUpdate,
]);

export const ebayCreateOfferDescription =
	"Update a listing (price, qty, aspects, images, etc). PATCH /v1/listings/{sku}. Used after the initial create to adjust price or stock.";

export async function ebayCreateOfferExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const sku = String(args.sku);
		const { sku: _drop, ...patch } = args as Record<string, unknown>;
		return await client.listings.update(sku, patch as unknown as Parameters<typeof client.listings.update>[1]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/{sku}");
		return { error: "listings_update_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayPublishOfferInput = Type.Object({
	sku: Type.String(),
});

export const ebayPublishOfferDescription =
	"Re-publish a draft / withdrawn listing. POST /v1/listings/{sku}/relist. Used to recover after a publish-step failure.";

export async function ebayPublishOfferExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.relist(args.sku as string);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/{sku}/relist");
		return { error: "listings_relist_failed", status: e.status, url: e.url, message: e.message };
	}
}
