/**
 * sell/stores — store-categories config.
 */

import type { StoreCategory, StoreCategoryUpsert } from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";

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
	}).catch(() => null);
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
