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

/**
 * Store metadata — name, URL, description, theme. Wraps Sell Stores
 * `GET /sell/stores/v1/store`. Read-only — eBay routes store
 * configuration changes through the seller dashboard or Trading
 * `SetStore` (intentionally not REST-exposed).
 *
 * Requires the `sell.stores.readonly` scope on the user's OAuth token.
 */
export interface StoreInfo {
	storeName: string | null;
	storeUrl: string | null;
	storeDescription: string | null;
	storeStatus: string | null;
	storeTheme: { colorTheme?: string; fontTheme?: string } | null;
	storeSubscriptionLevel: string | null;
}

interface UpstreamStoreResponse {
	storeName?: string;
	storeUrl?: string;
	storeDescription?: string;
	storeStatus?: string;
	storeTheme?: { colorTheme?: string; fontTheme?: string };
	storeSubscriptionLevel?: string;
}

export async function getStoreInfo(ctx: StoreContext): Promise<StoreInfo | null> {
	const res = await sellRequest<UpstreamStoreResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/stores/v1/store",
		marketplace: ctx.marketplace,
	}).catch(() => null);
	if (!res) return null;
	return {
		storeName: res.storeName ?? null,
		storeUrl: res.storeUrl ?? null,
		storeDescription: res.storeDescription ?? null,
		storeStatus: res.storeStatus ?? null,
		storeTheme: res.storeTheme ?? null,
		storeSubscriptionLevel: res.storeSubscriptionLevel ?? null,
	};
}

/**
 * Async store-task list. Wraps Sell Stores `GET /sell/stores/v1/store/
 * tasks`. Returns long-running operations against the store (e.g.
 * bulk-category re-org). Each entry has a status — caller polls
 * `getStoreTask(id)` until terminal.
 */
export interface StoreTask {
	taskId: string;
	status: string;
	taskType: string | null;
	creationDate: string | null;
	completionDate: string | null;
	errorMessage: string | null;
}

interface UpstreamStoreTask {
	taskId?: string;
	status?: string;
	taskType?: string;
	creationDate?: string;
	completionDate?: string;
	errorMessage?: string;
}

interface UpstreamTasksResponse {
	tasks?: UpstreamStoreTask[];
}

function toStoreTask(t: UpstreamStoreTask): StoreTask {
	return {
		taskId: t.taskId ?? "",
		status: t.status ?? "UNKNOWN",
		taskType: t.taskType ?? null,
		creationDate: t.creationDate ?? null,
		completionDate: t.completionDate ?? null,
		errorMessage: t.errorMessage ?? null,
	};
}

export async function listStoreTasks(ctx: StoreContext): Promise<{ tasks: StoreTask[] }> {
	const res = await sellRequest<UpstreamTasksResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/stores/v1/store/tasks",
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return { tasks: (res?.tasks ?? []).map(toStoreTask) };
}

export async function getStoreTask(taskId: string, ctx: StoreContext): Promise<StoreTask | null> {
	const res = await sellRequest<UpstreamStoreTask>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/stores/v1/store/tasks/${encodeURIComponent(taskId)}`,
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return res ? toStoreTask(res) : null;
}
