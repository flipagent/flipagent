/**
 * sell/stores — store-categories config.
 */

import type { StoreCategory, StoreCategoryUpsert } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";

interface EbayStoreCategory {
	categoryId: string;
	name: string;
	parentCategoryId?: string;
	listingCount?: number;
	childCategories?: EbayStoreCategory[];
}

function flatten(node: EbayStoreCategory, into: StoreCategory[]) {
	into.push({
		id: node.categoryId,
		name: node.name,
		...(node.parentCategoryId ? { parentId: node.parentCategoryId } : {}),
		...(node.listingCount !== undefined ? { listingCount: node.listingCount } : {}),
	});
	for (const child of node.childCategories ?? []) flatten(child, into);
}

export interface StoreContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function getStoreCategories(ctx: StoreContext): Promise<{ categories: StoreCategory[] }> {
	const res = await sellRequest<{ storeCategories?: EbayStoreCategory[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/stores/v2/store-categories",
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	const categories: StoreCategory[] = [];
	for (const root of res?.storeCategories ?? []) flatten(root, categories);
	return { categories };
}

export async function upsertStoreCategories(
	input: StoreCategoryUpsert,
	ctx: StoreContext,
): Promise<{ categories: StoreCategory[] }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/stores/v2/store-categories",
		body: { storeCategories: input.categories.map((c) => ({ name: c.name, parentCategoryId: c.parentId })) },
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return getStoreCategories(ctx);
}

/**
 * Store metadata — name, URL, description, theme. Backed by Trading
 * `GetStore` (XML) instead of Sell Stores REST `/sell/stores/v1/store`.
 *
 * Why Trading: verified live 2026-05-02 that REST `/sell/stores/v1/*`
 * uniformly 403s "Insufficient permissions" even with an active eBay
 * Store on the account, because eBay silently drops the
 * `sell.stores.readonly` scope from user consent for non-approved
 * apps (the API is gated behind eBay-side app approval we don't
 * have). Trading `GetStore` returns the same data with no scope
 * gate.
 *
 * Switch to REST once we get Stores API app approval through the
 * developer portal — the wire shape is the same.
 */
import { parseTrading, stringFrom, tradingCall } from "./ebay/trading/client.js";

export interface StoreInfo {
	storeName: string | null;
	storeUrl: string | null;
	storeDescription: string | null;
	storeStatus: string | null;
	storeSubscriptionLevel: string | null;
}

export async function getStoreInfo(_ctx: StoreContext, accessToken: string): Promise<StoreInfo | null> {
	const xml = await tradingCall({
		callName: "GetStore",
		accessToken,
		body: `<?xml version="1.0" encoding="utf-8"?>
<GetStoreRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
</GetStoreRequest>`,
	}).catch(swallowEbay404);
	if (!xml) return null;
	const parsed = parseTrading(xml, "GetStore");
	const store = (parsed.Store ?? {}) as Record<string, unknown>;
	if (!store || Object.keys(store).length === 0) return null;
	const subscription = (store.SubscriptionLevel ?? store.StoreSubscriptionLevel) as unknown;
	return {
		storeName: stringFrom(store.Name),
		storeUrl: stringFrom(store.URL),
		storeDescription: stringFrom(store.Description),
		storeStatus: stringFrom(store.Status),
		storeSubscriptionLevel: stringFrom(subscription),
	};
}

// `listStoreTasks` / `getStoreTask` deliberately not implemented —
// no Trading equivalent for the async store-task queue. Re-add via
// Sell Stores REST once we get app approval, or via bridge if the
// use case warrants scraping My eBay > Subscriptions > Store > Tasks.
