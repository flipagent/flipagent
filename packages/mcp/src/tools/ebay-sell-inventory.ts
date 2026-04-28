/**
 * Sell-side: create / replace an inventory item, then create + publish an
 * offer. Each call requires the api key to be connected to an eBay account
 * (POST /v1/connect/ebay). Bodies are eBay's verbatim shapes — passed through.
 */

import { InventoryItem, OfferDetails } from "@flipagent/types/ebay/sell";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayCreateInventoryItemInput = Type.Object({
	sku: Type.String({ description: "Your seller-defined SKU." }),
	body: InventoryItem,
});

export const ebayCreateInventoryItemDescription =
	"Create or replace an inventory item by SKU. Calls PUT /v1/inventory/inventory_item/{sku}. Caller must have connected eBay via /v1/connect/ebay.";

export async function ebayCreateInventoryItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.inventory.putItem(args.sku as string, args.body);
	} catch (err) {
		const e = toApiCallError(err, "/v1/inventory/inventory_item/{sku}");
		return { error: "inventory_put_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayCreateOfferInput = Type.Object({
	body: OfferDetails,
});

export const ebayCreateOfferDescription =
	"Create an unpublished offer for an existing inventory item. Calls POST /v1/inventory/offer. Returns an offerId you then publish.";

export async function ebayCreateOfferExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.inventory.createOffer(args.body);
	} catch (err) {
		const e = toApiCallError(err, "/v1/inventory/offer");
		return { error: "offer_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayPublishOfferInput = Type.Object({
	offerId: Type.String(),
});

export const ebayPublishOfferDescription =
	"Publish an offer (turns it into a live eBay listing). Calls POST /v1/inventory/offer/{offerId}/publish. Returns a listingId.";

export async function ebayPublishOfferExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.inventory.publishOffer(args.offerId as string);
	} catch (err) {
		const e = toApiCallError(err, "/v1/inventory/offer/{offerId}/publish");
		return { error: "offer_publish_failed", status: e.status, url: e.url, message: e.message };
	}
}
