/**
 * `/v1/store/*` — eBay Store category management.
 */

import { StoreCategoriesResponse, StoreCategoryUpsert } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	getStoreCategories,
	getStoreInfo,
	getStoreTask,
	listStoreTasks,
	upsertStoreCategories,
} from "../../services/store.js";
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

storeRoute.get(
	"/",
	describeRoute({
		tags: ["Store"],
		summary: "Get the seller's store metadata (name, URL, description, theme)",
		description:
			"Wraps Sell Stores `GET /sell/stores/v1/store`. Read-only — eBay routes store config writes through the seller dashboard or Trading `SetStore`. Requires `sell.stores.readonly` OAuth scope (added 2026-05-02; existing OAuth bindings need re-consent on next /v1/connect/ebay/start).",
		responses: {
			200: { description: "Store metadata." },
			404: errorResponse("No store on this account."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		const r = await getStoreInfo({
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		if (!r) return c.json({ error: "store_not_found", message: "No eBay Store on this account." }, 404);
		return c.json({ ...r, source: "rest" as const });
	},
);

storeRoute.get(
	"/tasks",
	describeRoute({
		tags: ["Store"],
		summary: "List async store-tasks (e.g. bulk category re-org)",
		responses: { 200: { description: "Tasks." }, ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listStoreTasks({
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
		}),
);

storeRoute.get(
	"/tasks/:id",
	describeRoute({
		tags: ["Store"],
		summary: "Get one async store-task by id",
		responses: { 200: { description: "Task." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getStoreTask(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		if (!r) return c.json({ error: "store_task_not_found" }, 404);
		return c.json({ ...r, source: "rest" as const });
	},
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
