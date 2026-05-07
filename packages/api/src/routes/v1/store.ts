/**
 * `/v1/store/*` — eBay Store category management.
 */

import { StoreCategoriesResponse, StoreCategoryUpsert } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { getStoreCategories, getStoreInfo, upsertStoreCategories } from "../../services/store.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const storeRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

storeRoute.get(
	"/",
	describeRoute({
		tags: ["Store"],
		summary: "Get the seller's eBay Store metadata (name, URL, description)",
		description:
			"Backed by Trading `GetStore` because Sell Stores REST `/sell/stores/v1/store` is gated behind app-level approval we don't have (verified 2026-05-02: 403 even with `sell.stores.readonly` consented). Trading returns the same data with no scope gate. Read-only — store config writes go through the seller dashboard or Trading `SetStore`.",
		responses: {
			200: { description: "Store metadata." },
			404: errorResponse("No eBay Store on this account."),
			...COMMON,
		},
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const r = await getStoreInfo({ apiKeyId: c.var.apiKey.id, marketplace: ebayMarketplaceId() }, accessToken);
		if (!r) return c.json({ error: "store_not_found", message: "No eBay Store on this account." }, 404);
		return c.json({ ...r });
	}),
);

storeRoute.get(
	"/categories",
	describeRoute({
		tags: ["Store"],
		summary: "List store categories",
		responses: { 200: jsonResponse("Categories.", StoreCategoriesResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getStoreCategories({
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);

storeRoute.put(
	"/categories",
	describeRoute({
		tags: ["Store"],
		summary: "Replace store categories",
		responses: { 200: jsonResponse("Updated.", StoreCategoriesResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(StoreCategoryUpsert),
	async (c) =>
		c.json({
			...(await upsertStoreCategories(c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);
