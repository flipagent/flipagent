/**
 * Bulk listing operations — bulk reads (inventory + offer), bulk writes
 * (price/qty + upsert + publish), multi-variation parent group, Trading
 * migration. Wraps eBay sell/inventory bulk endpoints + inventory_item_group.
 */

import type {
	BulkInventoryGet,
	BulkOfferGet,
	ListingBulkPriceUpdate,
	ListingBulkPublish,
	ListingBulkResult,
	ListingBulkUpsert,
	ListingGroup,
	ListingGroupUpsert,
	ListingMigrate,
	ListingMigrateResult,
} from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "../ebay/rest/user-client.js";

function dollarString(cents: number): string {
	return (cents / 100).toFixed(2);
}

export interface BulkContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function bulkUpdatePriceQuantity(
	input: ListingBulkPriceUpdate,
	ctx: BulkContext,
): Promise<ListingBulkResult> {
	const requests = input.updates.map((u) => ({
		sku: u.sku,
		...(u.offerId
			? {
					offers: [
						{
							offerId: u.offerId,
							...(u.price ? { price: { value: dollarString(u.price.value), currency: u.price.currency } } : {}),
						},
					],
				}
			: {}),
		...(u.quantity !== undefined ? { shipToLocationAvailability: { quantity: u.quantity } } : {}),
	}));
	const res = await sellRequest<{
		responses?: Array<{ sku?: string; statusCode: number; errors?: Array<{ message?: string }> }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/bulk_update_price_quantity",
		body: { requests },
		marketplace: ctx.marketplace,
	});
	return {
		responses: (res?.responses ?? []).map((r) => ({
			sku: r.sku,
			statusCode: r.statusCode,
			...(r.errors ? { errors: r.errors.map((e) => ({ message: e.message ?? "" })) } : {}),
		})),
	};
}

export async function bulkUpsertInventory(input: ListingBulkUpsert, ctx: BulkContext): Promise<ListingBulkResult> {
	const requests = input.items.map((it) => ({
		sku: it.sku,
		product: { title: it.title, description: it.description, imageUrls: it.images, aspects: it.aspects },
		condition: it.condition.toUpperCase(),
		availability: { shipToLocationAvailability: { quantity: it.quantity } },
	}));
	const res = await sellRequest<{
		responses?: Array<{ sku: string; statusCode: number; errors?: Array<{ message?: string }> }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/bulk_create_or_replace_inventory_item",
		body: { requests },
		marketplace: ctx.marketplace,
	});
	return {
		responses: (res?.responses ?? []).map((r) => ({
			sku: r.sku,
			statusCode: r.statusCode,
			...(r.errors ? { errors: r.errors.map((e) => ({ message: e.message ?? "" })) } : {}),
		})),
	};
}

export async function bulkPublishOffer(input: ListingBulkPublish, ctx: BulkContext): Promise<ListingBulkResult> {
	const requests = input.offerIds.map((offerId) => ({ offerId }));
	const res = await sellRequest<{
		responses?: Array<{
			offerId: string;
			listingId?: string;
			statusCode: number;
			errors?: Array<{ message?: string }>;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/bulk_publish_offer",
		body: { requests },
		marketplace: ctx.marketplace,
	});
	return {
		responses: (res?.responses ?? []).map((r) => ({
			offerId: r.offerId,
			...(r.listingId ? { listingId: r.listingId } : {}),
			statusCode: r.statusCode,
			...(r.errors ? { errors: r.errors.map((e) => ({ message: e.message ?? "" })) } : {}),
		})),
	};
}

/* ----- inventory_item_group (multi-variation parent) ----------------- */

export async function getListingGroup(id: string, ctx: BulkContext): Promise<ListingGroup | null> {
	const res = await sellRequest<{
		title: string;
		description?: string;
		imageUrls?: string[];
		variantSKUs?: string[];
		variesBy?: ListingGroup["variesBy"];
		aspects?: Record<string, string[]>;
		brand?: string;
		mpn?: string;
		gtin?: string;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	if (!res) return null;
	return {
		id,
		title: res.title,
		images: res.imageUrls ?? [],
		variantSkus: res.variantSKUs ?? [],
		...(res.description ? { description: res.description } : {}),
		...(res.variesBy ? { variesBy: res.variesBy } : {}),
		...(res.aspects ? { aspects: res.aspects } : {}),
		...(res.brand ? { brand: res.brand } : {}),
		...(res.mpn ? { mpn: res.mpn } : {}),
		...(res.gtin ? { gtin: res.gtin } : {}),
	};
}

export async function upsertListingGroup(
	id: string,
	input: ListingGroupUpsert,
	ctx: BulkContext,
): Promise<ListingGroup | null> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(id)}`,
		body: {
			title: input.title,
			description: input.description,
			imageUrls: input.images,
			variantSKUs: input.variantSkus,
			variesBy: input.variesBy,
			aspects: input.aspects,
			brand: input.brand,
			mpn: input.mpn,
			gtin: input.gtin,
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return getListingGroup(id, ctx);
}

export async function deleteListingGroup(id: string, ctx: BulkContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/inventory/v1/inventory_item_group/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}

/* ----- migrate (Trading listing → inventory) ------------------------- */

export async function migrateListings(input: ListingMigrate, ctx: BulkContext): Promise<ListingMigrateResult> {
	const res = await sellRequest<{
		responses?: Array<{
			legacyItemId: string;
			inventoryItemSku?: string;
			offerId?: string;
			statusCode: number;
			errors?: Array<{ message?: string }>;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/bulk_migrate_listing",
		body: { requests: input.legacyListingIds.map((id) => ({ listingId: id })) },
		marketplace: ctx.marketplace,
	});
	return {
		responses: (res?.responses ?? []).map((r) => ({
			legacyItemId: r.legacyItemId,
			...(r.inventoryItemSku ? { inventoryItemSku: r.inventoryItemSku } : {}),
			...(r.offerId ? { offerId: r.offerId } : {}),
			statusCode: r.statusCode,
			...(r.errors ? { errors: r.errors.map((e) => ({ message: e.message ?? "" })) } : {}),
		})),
	};
}

export async function bulkGetInventory(
	input: BulkInventoryGet,
	ctx: BulkContext,
): Promise<{ items: Array<Record<string, unknown>> }> {
	const res = await sellRequest<{ responses?: Array<Record<string, unknown>> }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/bulk_get_inventory_item",
		body: { requests: input.skus.map((sku) => ({ sku })) },
		marketplace: ctx.marketplace,
	});
	return { items: res?.responses ?? [] };
}

export async function bulkGetOffer(
	input: BulkOfferGet,
	ctx: BulkContext,
): Promise<{ offers: Array<Record<string, unknown>> }> {
	const res = await sellRequest<{ responses?: Array<Record<string, unknown>> }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/bulk_get_offer",
		body: { requests: input.offerIds.map((offerId) => ({ offerId })) },
		marketplace: ctx.marketplace,
	});
	return { offers: res?.responses ?? [] };
}
