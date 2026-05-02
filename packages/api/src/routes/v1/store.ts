/**
 * `/v1/store/*` — eBay Store category management.
 */

import { StoreCategoriesResponse, StoreCategoryUpsert } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getStoreCategories, upsertStoreCategories } from "../../services/store.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const storeRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

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
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
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
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
		}),
);
