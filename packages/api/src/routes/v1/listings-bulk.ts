/**
 * `/v1/listings/bulk/*` — bulk reads (inventory + offers) and bulk
 * writes (price/qty + upsert + publish + Trading-API migration).
 */

import {
	BulkInventoryGet,
	BulkOfferGet,
	ListingBulkPriceUpdate,
	ListingBulkPublish,
	ListingBulkResult,
	ListingBulkUpsert,
	ListingMigrate,
	ListingMigrateResult,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	bulkGetInventory,
	bulkGetOffer,
	bulkPublishOffer,
	bulkUpdatePriceQuantity,
	bulkUpsertInventory,
	migrateListings,
} from "../../services/listings/bulk.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const listingsBulkRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

listingsBulkRoute.post(
	"/get-inventory",
	describeRoute({
		tags: ["Listings/bulk"],
		summary: "Bulk read inventory items",
		responses: { 200: { description: "Items." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(BulkInventoryGet),
	async (c) =>
		c.json({
			...(await bulkGetInventory(c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);

listingsBulkRoute.post(
	"/get-offers",
	describeRoute({
		tags: ["Listings/bulk"],
		summary: "Bulk read offers",
		responses: { 200: { description: "Offers." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(BulkOfferGet),
	async (c) =>
		c.json({
			...(await bulkGetOffer(c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);

listingsBulkRoute.post(
	"/price",
	describeRoute({
		tags: ["Listings/bulk"],
		summary: "Bulk update price + quantity (up to 25)",
		responses: { 200: jsonResponse("Per-row results.", ListingBulkResult), ...COMMON },
	}),
	requireApiKey,
	tbBody(ListingBulkPriceUpdate),
	async (c) => {
		const r = await bulkUpdatePriceQuantity(c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

listingsBulkRoute.post(
	"/upsert",
	describeRoute({
		tags: ["Listings/bulk"],
		summary: "Bulk create-or-replace inventory items (up to 25)",
		responses: { 200: jsonResponse("Per-row results.", ListingBulkResult), ...COMMON },
	}),
	requireApiKey,
	tbBody(ListingBulkUpsert),
	async (c) => {
		const r = await bulkUpsertInventory(c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

listingsBulkRoute.post(
	"/publish",
	describeRoute({
		tags: ["Listings/bulk"],
		summary: "Bulk publish offers (up to 25)",
		responses: { 200: jsonResponse("Per-row results.", ListingBulkResult), ...COMMON },
	}),
	requireApiKey,
	tbBody(ListingBulkPublish),
	async (c) => {
		const r = await bulkPublishOffer(c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

listingsBulkRoute.post(
	"/migrate",
	describeRoute({
		tags: ["Listings/bulk"],
		summary: "Migrate Trading-API listings into the inventory model",
		responses: { 200: jsonResponse("Per-id result.", ListingMigrateResult), ...COMMON },
	}),
	requireApiKey,
	tbBody(ListingMigrate),
	async (c) => {
		const r = await migrateListings(c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);
