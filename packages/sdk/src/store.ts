/**
 * `client.store.*` — eBay Store category management.
 */

import type { StoreCategoriesResponse, StoreCategoryUpsert } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface StoreClient {
	categories(): Promise<StoreCategoriesResponse>;
	upsertCategories(body: StoreCategoryUpsert): Promise<StoreCategoriesResponse>;
}

export function createStoreClient(http: FlipagentHttp): StoreClient {
	return {
		categories: () => http.get("/v1/store/categories"),
		upsertCategories: (body) => http.put("/v1/store/categories", body),
	};
}
