/**
 * eBay Store category tools — read + upsert the seller's custom store
 * categories. Required for sellers with an eBay Store subscription
 * who want listings filed under non-eBay-default category buckets.
 */

import { StoreCategoryUpsert } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_store_categories ---------------------- */

export const storeCategoriesInput = Type.Object({});
export const storeCategoriesDescription =
	"List the seller's eBay Store categories (custom storefront buckets, not the marketplace taxonomy). GET /v1/store/categories.";
export async function storeCategoriesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.store.categories();
	} catch (err) {
		const e = toApiCallError(err, "/v1/store/categories");
		return { error: "store_categories_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_store_categories_upsert ------------------- */

export { StoreCategoryUpsert as storeCategoriesUpsertInput };
export const storeCategoriesUpsertDescription =
	"Upsert the seller's custom store-category tree. PUT /v1/store/categories. Replaces the full set. Pair with `flipagent_seller_subscription` to confirm the seller has a Store tier first.";
export async function storeCategoriesUpsertExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.store.upsertCategories(args as Parameters<typeof client.store.upsertCategories>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/store/categories");
		return { error: "store_categories_upsert_failed", status: e.status, url: e.url, message: e.message };
	}
}
