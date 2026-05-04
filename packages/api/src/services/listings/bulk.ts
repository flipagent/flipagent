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
		// `locale` is a REQUIRED field on `InventoryItemWithSkuLocale` per
		// the OAS3 spec — verified live 2026-05-03 ("Valid SKU and locale
		// information are required for all the InventoryItems in the
		// request"). Single-item PUT `/inventory_item/{sku}` infers locale
		// from the Content-Language header (en-US default), but the bulk
		// variant requires it inside the request body. Default to en_US
		// (underscore — eBay's `LocaleEnum`) to match the en-US header.
		locale: "en_US",
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
	// Spec: `references/ebay-mcp/docs/_mirror/sell_inventory_v1_oas3.json`
	// `InventoryItemGroup` schema. Verified 2026-05-03 via field-diff:
	// only aspects, description, imageUrls, inventoryItemGroupKey,
	// subtitle, title, variantSKUs, variesBy, videoIds exist. Previous
	// wrapper destructured `brand`, `mpn`, `gtin` — those belong to
	// per-SKU `inventory_item`, not the group. They were always undefined.
	const res = await sellRequest<{
		title: string;
		description?: string;
		imageUrls?: string[];
		variantSKUs?: string[];
		variesBy?: ListingGroup["variesBy"];
		aspects?: Record<string, string[]>;
		subtitle?: string;
		videoIds?: string[];
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
		...(res.subtitle ? { subtitle: res.subtitle } : {}),
		...(res.videoIds ? { videoIds: res.videoIds } : {}),
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
			...(input.subtitle ? { subtitle: input.subtitle } : {}),
			...(input.videoIds ? { videoIds: input.videoIds } : {}),
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
	// eBay's Sell Inventory API has no `bulk_get_offer` endpoint — verified
	// against `references/ebay-mcp/docs/sell-apps/listing-management/sell_inventory_v1_oas3.json`
	// and live-probed (returns 404 errorId 2002). The published bulk
	// surface is `bulk_create_offer`, `bulk_publish_offer`,
	// `bulk_get_inventory_item` only. For offers we fan out single
	// `GET /offer/{offerId}` calls in parallel; the public route shape
	// (`/v1/listings/bulk/get-offers`) is preserved.
	const settled = await Promise.allSettled(
		input.offerIds.map((offerId) =>
			sellRequest<Record<string, unknown>>({
				apiKeyId: ctx.apiKeyId,
				method: "GET",
				path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
				marketplace: ctx.marketplace,
			}),
		),
	);
	const offers = settled.map((r, i): Record<string, unknown> => {
		if (r.status === "fulfilled") return r.value;
		const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
		return { offerId: input.offerIds[i], errors: [{ message: reason }] };
	});
	return { offers };
}
