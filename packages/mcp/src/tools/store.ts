/**
 * eBay Store category tools — read + upsert the seller's custom store
 * categories. Required for sellers with an eBay Store subscription
 * who want listings filed under non-eBay-default category buckets.
 */

import { StoreCategoryUpsert } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_store_categories ---------------------- */

export const storeCategoriesInput = Type.Object({});
export const storeCategoriesDescription =
	'List the seller\'s custom eBay Store categories — the storefront buckets, not the marketplace taxonomy. Calls GET /v1/store/categories. **When to use** — sellers with an eBay Store subscription file listings under their own custom buckets ("Vintage Lenses", "Audio Gear", …); use this to fetch the existing tree before assigning a listing or building a UI. Marketplace category (the eBay-side taxonomy) is a separate concept — use `flipagent_list_categories` for that. **Inputs** — none. **Output** — `{ categories: [{ id, name, parentId, children?: [...] }] }` (nested tree). **Prereqs** — eBay seller account connected, eBay Store subscription active. **Example** — call with `{}`.';
export async function storeCategoriesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.store.categories();
	} catch (err) {
		return toolErrorEnvelope(err, "store_categories_failed", "/v1/store/categories");
	}
}

/* --------------------- flipagent_store_categories_upsert ------------------- */

export { StoreCategoryUpsert as storeCategoriesUpsertInput };
export const storeCategoriesUpsertDescription =
	"Replace the seller's eBay Store custom-category tree (full upsert, not a patch). Calls PUT /v1/store/categories. **When to use** — restructuring the storefront. **Destructive**: passes the entire tree, removing any category not in the payload. To add one category, fetch the current tree with `flipagent_list_store_categories` first, then send the modified tree back. **Inputs** — `categories: [{ id?, name, parentId?, children? }]` (omit `id` for new categories; flipagent assigns ids server-side). **Output** — updated tree. **Prereqs** — eBay seller account connected, Store subscription active — call `flipagent_get_seller_subscription` first if unsure. **Example** — read tree, append a new top-level node, send the modified tree back.";
export async function storeCategoriesUpsertExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.store.upsertCategories(args as Parameters<typeof client.store.upsertCategories>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "store_categories_upsert_failed", "/v1/store/categories");
	}
}

/* ----------------------------- flipagent_get_store ------------------------- */

export const storeGetInput = Type.Object({});
export const storeGetDescription =
	"Fetch the seller's eBay Store metadata — name, URL, description, status, subscription level. Calls GET /v1/store. **Backed by Trading `GetStore`** (XML) since Sell Stores REST is gated behind app-level approval we don't have. **When to use** — display the seller's storefront brand info (header, dashboard summary, profile page). Read-only — store config writes go through the seller dashboard or Trading SetStore. **Inputs** — none. **Output** — `{ storeName, storeUrl, storeDescription, storeStatus, storeSubscriptionLevel }`. **Prereqs** — eBay seller account connected with an active eBay Store subscription. 404 if no Store on the account. **Example** — call with `{}`.";
export async function storeGetExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.store.info();
	} catch (err) {
		return toolErrorEnvelope(err, "store_get_failed", "/v1/store");
	}
}

// `flipagent_list_store_tasks` / `flipagent_get_store_task` left out —
// no Trading equivalent for the async store-task queue, and Sell
// Stores REST is gated. Re-add via Sell Stores once we get app
// approval, or via bridge if the use case warrants scraping.
