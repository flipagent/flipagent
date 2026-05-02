/**
 * `client.categories.*` — taxonomy reads, normalized.
 */

import type {
	CategoriesListQuery,
	CategoriesListResponse,
	CategoryAspectsResponse,
	CategorySuggestQuery,
	CategorySuggestResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface CategoriesClient {
	list(params?: CategoriesListQuery): Promise<CategoriesListResponse>;
	suggest(params: CategorySuggestQuery): Promise<CategorySuggestResponse>;
	aspects(categoryId: string): Promise<CategoryAspectsResponse>;
}

export function createCategoriesClient(http: FlipagentHttp): CategoriesClient {
	return {
		list: (params) => http.get("/v1/categories", params as Record<string, string | number | undefined> | undefined),
		suggest: (params) => http.get("/v1/categories/suggest", params as Record<string, string | number | undefined>),
		aspects: (categoryId) => http.get(`/v1/categories/${encodeURIComponent(categoryId)}/aspects`),
	};
}
