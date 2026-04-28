/**
 * `client.markets.*` — taxonomy + selling policies. Marketplace-level
 * configuration that lives on the seller's account.
 */

import type { FlipagentHttp } from "./http.js";

export interface TaxonomyClient {
	defaultCategoryTreeId(marketplaceId: string): Promise<{ categoryTreeId?: string }>;
	getCategoryTree(categoryTreeId: string): Promise<unknown>;
	getCategorySuggestions(categoryTreeId: string, q: string): Promise<unknown>;
	getItemAspectsForCategory(categoryTreeId: string, categoryId: string): Promise<unknown>;
}

export interface PoliciesClient {
	listPaymentPolicies(query?: Record<string, string>): Promise<unknown>;
	createPaymentPolicy(body: unknown): Promise<unknown>;
	listFulfillmentPolicies(query?: Record<string, string>): Promise<unknown>;
	createFulfillmentPolicy(body: unknown): Promise<unknown>;
	listReturnPolicies(query?: Record<string, string>): Promise<unknown>;
	createReturnPolicy(body: unknown): Promise<unknown>;
	getPrivilege(): Promise<unknown>;
}

export interface MarketsClient {
	taxonomy: TaxonomyClient;
	policies: PoliciesClient;
}

export function createMarketsClient(http: FlipagentHttp): MarketsClient {
	return {
		taxonomy: {
			defaultCategoryTreeId: (marketplaceId) =>
				http.get("/v1/markets/taxonomy/get_default_category_tree_id", { marketplace_id: marketplaceId }),
			getCategoryTree: (categoryTreeId) =>
				http.get(`/v1/markets/taxonomy/category_tree/${encodeURIComponent(categoryTreeId)}`),
			getCategorySuggestions: (categoryTreeId, q) =>
				http.get(
					`/v1/markets/taxonomy/category_tree/${encodeURIComponent(categoryTreeId)}/get_category_suggestions`,
					{ q },
				),
			getItemAspectsForCategory: (categoryTreeId, categoryId) =>
				http.get(
					`/v1/markets/taxonomy/category_tree/${encodeURIComponent(categoryTreeId)}/get_item_aspects_for_category`,
					{ category_id: categoryId },
				),
		},
		policies: {
			listPaymentPolicies: (query) => http.get("/v1/markets/policies/payment_policy", query),
			createPaymentPolicy: (body) => http.post("/v1/markets/policies/payment_policy", body),
			listFulfillmentPolicies: (query) => http.get("/v1/markets/policies/fulfillment_policy", query),
			createFulfillmentPolicy: (body) => http.post("/v1/markets/policies/fulfillment_policy", body),
			listReturnPolicies: (query) => http.get("/v1/markets/policies/return_policy", query),
			createReturnPolicy: (body) => http.post("/v1/markets/policies/return_policy", body),
			getPrivilege: () => http.get("/v1/markets/policies/privilege"),
		},
	};
}
