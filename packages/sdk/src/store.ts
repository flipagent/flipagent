/**
 * `client.store.*` — eBay Store category management.
 */

import type { StoreCategoriesResponse, StoreCategoryUpsert } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface StoreInfo {
	storeName: string | null;
	storeUrl: string | null;
	storeDescription: string | null;
	storeStatus: string | null;
	storeTheme: { colorTheme?: string; fontTheme?: string } | null;
	storeSubscriptionLevel: string | null;
	source?: string;
}

export interface StoreTask {
	taskId: string;
	status: string;
	taskType: string | null;
	creationDate: string | null;
	completionDate: string | null;
	errorMessage: string | null;
}

export interface StoreClient {
	info(): Promise<StoreInfo>;
	tasks(): Promise<{ tasks: StoreTask[] }>;
	task(id: string): Promise<StoreTask>;
	categories(): Promise<StoreCategoriesResponse>;
	upsertCategories(body: StoreCategoryUpsert): Promise<StoreCategoriesResponse>;
}

export function createStoreClient(http: FlipagentHttp): StoreClient {
	return {
		info: () => http.get("/v1/store"),
		tasks: () => http.get("/v1/store/tasks"),
		task: (id) => http.get(`/v1/store/tasks/${encodeURIComponent(id)}`),
		categories: () => http.get("/v1/store/categories"),
		upsertCategories: (body) => http.put("/v1/store/categories", body),
	};
}
