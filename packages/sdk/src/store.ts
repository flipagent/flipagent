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
	storeSubscriptionLevel: string | null;
	source?: string;
}

export interface StoreClient {
	info(): Promise<StoreInfo>;
	categories(): Promise<StoreCategoriesResponse>;
	upsertCategories(body: StoreCategoryUpsert): Promise<StoreCategoriesResponse>;
}

export function createStoreClient(http: FlipagentHttp): StoreClient {
	return {
		info: () => http.get("/v1/store"),
		categories: () => http.get("/v1/store/categories"),
		upsertCategories: (body) => http.put("/v1/store/categories", body),
	};
}
