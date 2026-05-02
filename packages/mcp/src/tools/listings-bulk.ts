/**
 * Bulk-listing tools — backed by `/v1/listings/bulk/*`. Power-user
 * surface for fetching, repricing, upserting, publishing, and
 * migrating many listings in one call. Each returns a per-row
 * `ListingBulkResult` (one entry per input sku) — partial successes
 * are normal; agents should iterate the result and retry failures.
 */

import {
	BulkInventoryGet,
	BulkOfferGet,
	ListingBulkPriceUpdate,
	ListingBulkPublish,
	ListingBulkUpsert,
	ListingMigrate,
} from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* --------------------- flipagent_listings_bulk_get_inventory --------------- */

export { BulkInventoryGet as listingsBulkGetInventoryInput };
export const listingsBulkGetInventoryDescription =
	"Fetch many inventory rows by sku. POST /v1/listings/bulk/get-inventory. Body: `{ skus: string[] }`. Use to refresh a portfolio of SKUs in one round-trip.";
export async function listingsBulkGetInventoryExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listingsBulk.getInventory(args as Parameters<typeof client.listingsBulk.getInventory>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/bulk/get-inventory");
		return { error: "listings_bulk_get_inventory_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_listings_bulk_get_offers ---------------- */

export { BulkOfferGet as listingsBulkGetOffersInput };
export const listingsBulkGetOffersDescription =
	"Fetch many offers by offerId. POST /v1/listings/bulk/get-offers. Body: `{ offerIds: string[] }`.";
export async function listingsBulkGetOffersExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listingsBulk.getOffers(args as Parameters<typeof client.listingsBulk.getOffers>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/bulk/get-offers");
		return { error: "listings_bulk_get_offers_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_listings_bulk_update_prices --------------- */

export { ListingBulkPriceUpdate as listingsBulkUpdatePricesInput };
export const listingsBulkUpdatePricesDescription =
	"Reprice many listings in one call. POST /v1/listings/bulk/price. Body: `{ updates: [{ sku, priceCents }] }`. Faster than N × `flipagent_listings_update`.";
export async function listingsBulkUpdatePricesExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listingsBulk.updatePrices(args as Parameters<typeof client.listingsBulk.updatePrices>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/bulk/price");
		return { error: "listings_bulk_update_prices_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_listings_bulk_upsert ------------------- */

export { ListingBulkUpsert as listingsBulkUpsertInput };
export const listingsBulkUpsertDescription =
	"Upsert many inventory rows + offers atomically per row. POST /v1/listings/bulk/upsert. Single-row failure doesn't fail the batch — read per-row status from the result.";
export async function listingsBulkUpsertExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listingsBulk.upsert(args as Parameters<typeof client.listingsBulk.upsert>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/bulk/upsert");
		return { error: "listings_bulk_upsert_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_listings_bulk_publish ------------------- */

export { ListingBulkPublish as listingsBulkPublishInput };
export const listingsBulkPublishDescription =
	"Publish many offers in one call. POST /v1/listings/bulk/publish. Body: `{ offerIds: string[] }`.";
export async function listingsBulkPublishExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listingsBulk.publish(args as Parameters<typeof client.listingsBulk.publish>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/bulk/publish");
		return { error: "listings_bulk_publish_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_listings_bulk_migrate ------------------- */

export { ListingMigrate as listingsBulkMigrateInput };
export const listingsBulkMigrateDescription =
	"Migrate legacy Trading-API listings into the Inventory model. POST /v1/listings/bulk/migrate. One-time per legacy listing; required before bulk upsert / publish can target them.";
export async function listingsBulkMigrateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listingsBulk.migrate(args as Parameters<typeof client.listingsBulk.migrate>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/bulk/migrate");
		return { error: "listings_bulk_migrate_failed", status: e.status, url: e.url, message: e.message };
	}
}
