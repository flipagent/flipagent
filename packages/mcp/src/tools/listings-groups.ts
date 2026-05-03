/**
 * Inventory item-group bulk publish/withdraw + product compatibility
 * tools — for multi-variation listings (size/color matrices) and
 * parts/motors fitment data.
 */

import { ItemGroupActionRequest, ProductCompatibilityRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* --------------------- flipagent_publish_listing_group --------------------- */

export { ItemGroupActionRequest as listingsGroupPublishInput };
export const listingsGroupPublishDescription =
	"Publish all variant offers in an inventory_item_group in one call. Calls POST /v1/listings/groups/{key}/publish. **When to use** — multi-variation listings (size/color matrices); avoids the race that hand-publishing each variant would hit. **Inputs** — `{ inventoryItemGroupKey, marketplaceId }` (e.g. EBAY_US). **Output** — `{ listingId, warnings }`. **Prereqs** — eBay seller account connected; group + offers already drafted via `flipagent_create_listing` etc.";
export async function listingsGroupPublishExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.publishGroup(args as Parameters<typeof client.listings.publishGroup>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_group_publish_failed", "/v1/listings/groups/publish");
	}
}

/* -------------------- flipagent_withdraw_listing_group --------------------- */

export { ItemGroupActionRequest as listingsGroupWithdrawInput };
export const listingsGroupWithdrawDescription =
	"Withdraw all variant offers under one inventory_item_group. Calls POST /v1/listings/groups/{key}/withdraw. **Inputs** — `{ inventoryItemGroupKey, marketplaceId }`. **Output** — `{ ok: true }`.";
export async function listingsGroupWithdrawExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.withdrawGroup(args as Parameters<typeof client.listings.withdrawGroup>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_group_withdraw_failed", "/v1/listings/groups/withdraw");
	}
}

/* --------------------- flipagent_get_listing_compatibility ----------------- */

export const listingsCompatibilityGetInput = Type.Object({ sku: Type.String({ minLength: 1 }) });
export const listingsCompatibilityGetDescription =
	"Get the parts/motors compatibility set for one inventory item. Calls GET /v1/listings/{sku}/compatibility. **When to use** — read existing fitment data before editing. Without compatibility set, parts listings won't surface in eBay's parts-finder. **Inputs** — `sku`. **Output** — `{ compatibleProducts: [{ properties: [{name, value}], notes? }] }`.";
export async function listingsCompatibilityGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const sku = String(args.sku);
	try {
		const client = getClient(config);
		return await client.listings.getCompatibility(sku);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_compatibility_get_failed", `/v1/listings/${sku}/compatibility`);
	}
}

/* --------------------- flipagent_set_listing_compatibility ----------------- */

export const listingsCompatibilitySetInput = Type.Composite([
	Type.Object({ sku: Type.String({ minLength: 1 }) }),
	ProductCompatibilityRequest,
]);
export const listingsCompatibilitySetDescription =
	'Replace the parts/motors compatibility set on one inventory item. Calls PUT /v1/listings/{sku}/compatibility. **When to use** — declare which year/make/model combinations a part fits. Each row is a property/value list — Year=2018, Make=Honda, Model=Civic — describing one compatible vehicle/product. **Inputs** — `{ sku, compatibleProducts: [{ properties: [{name, value}], notes? }] }`. **Output** — `{ ok }`. **Prereqs** — eBay seller account connected; SKU must already exist in inventory. **Example** — `{ sku: "PART-A1", compatibleProducts: [{ properties: [{name: "Year", value: "2018"}, {name: "Make", value: "Honda"}, {name: "Model", value: "Civic"}] }] }`.';
export async function listingsCompatibilitySetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { sku, ...body } = args as { sku: string } & ProductCompatibilityRequest;
	try {
		const client = getClient(config);
		return await client.listings.setCompatibility(sku, body);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_compatibility_set_failed", `/v1/listings/${sku}/compatibility`);
	}
}

/* ------------------- flipagent_delete_listing_compatibility ---------------- */

export const listingsCompatibilityDeleteInput = Type.Object({ sku: Type.String({ minLength: 1 }) });
export const listingsCompatibilityDeleteDescription =
	"Delete all compatibility data for one inventory item. Calls DELETE /v1/listings/{sku}/compatibility. **Inputs** — `sku`. **Output** — empty 204.";
export async function listingsCompatibilityDeleteExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const sku = String(args.sku);
	try {
		const client = getClient(config);
		await client.listings.deleteCompatibility(sku);
		return { sku, removed: true };
	} catch (err) {
		return toolErrorEnvelope(err, "listings_compatibility_delete_failed", `/v1/listings/${sku}/compatibility`);
	}
}
