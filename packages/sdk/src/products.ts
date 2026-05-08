/**
 * `client.products.*` — flipagent-native cross-marketplace Products.
 * The canonical SKU surface; `client.marketplaces.ebay.catalog` mirrors
 * eBay's authoritative product DB separately.
 */

import type { Product, ProductListQuery, ProductListResponse, ResolveOutcome, ResolveRequest } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ProductsClient {
	list(query?: ProductListQuery): Promise<ProductListResponse>;
	get(id: string): Promise<Product>;
	resolve(req: ResolveRequest): Promise<ResolveOutcome>;
}

export function createProductsClient(http: FlipagentHttp): ProductsClient {
	return {
		list: (query) => http.get("/v1/products", (query ?? {}) as Record<string, string | number | undefined>),
		get: (id) => http.get(`/v1/products/${encodeURIComponent(id)}`),
		resolve: (req) => http.post("/v1/products/resolve", req),
	};
}
