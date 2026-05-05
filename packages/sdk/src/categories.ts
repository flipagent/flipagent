/**
 * `client.categories.*` — taxonomy reads, normalized.
 *
 * `marketplace` is the provider+region dispatch literal (`ebay_us`,
 * `ebay_gb`, `stockx`, …). Today only `ebay_us` is wired; the literal
 * expands when more adapters land. The server translates to the
 * provider-native id at the adapter boundary.
 */

import type {
	CategoriesListQuery,
	CategoriesListResponse,
	CategoryAspectsResponse,
	CategoryFetchItemAspectsResponse,
	CategorySuggestQuery,
	CategorySuggestResponse,
	Marketplace,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface CategoriesClient {
	list(params?: CategoriesListQuery): Promise<CategoriesListResponse>;
	suggest(params: CategorySuggestQuery): Promise<CategorySuggestResponse>;
	aspects(categoryId: string): Promise<CategoryAspectsResponse>;
	itemAspects(opts?: { marketplace?: Marketplace }): Promise<CategoryFetchItemAspectsResponse>;
}

export function createCategoriesClient(http: FlipagentHttp): CategoriesClient {
	return {
		list: (params) => http.get("/v1/categories", params as Record<string, string | number | undefined> | undefined),
		suggest: (params) => http.get("/v1/categories/suggest", params as Record<string, string | number | undefined>),
		aspects: (categoryId) => http.get(`/v1/categories/${encodeURIComponent(categoryId)}/aspects`),
		itemAspects: (opts) =>
			http.get("/v1/categories/item-aspects", opts?.marketplace ? { marketplace: opts.marketplace } : undefined),
	};
}
