/**
 * `client.products.*` — universal product catalog (eBay EPID).
 */

import type {
	Product,
	ProductMetadataForCategoriesQuery,
	ProductMetadataForCategoriesResponse,
	ProductMetadataQuery,
	ProductMetadataResponse,
	ProductSearchQuery,
	ProductsListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ProductsClient {
	get(epid: string): Promise<Product>;
	search(params: ProductSearchQuery): Promise<ProductsListResponse>;
	metadata(params: ProductMetadataQuery): Promise<ProductMetadataResponse>;
	categoryMetadata(params: ProductMetadataForCategoriesQuery): Promise<ProductMetadataForCategoriesResponse>;
}

export function createProductsClient(http: FlipagentHttp): ProductsClient {
	return {
		get: (epid) => http.get(`/v1/products/${encodeURIComponent(epid)}`),
		search: (params) => http.get("/v1/products/search", params as Record<string, string | number | undefined>),
		metadata: (params) => http.get("/v1/products/metadata", params as Record<string, string | number | undefined>),
		categoryMetadata: (params) =>
			http.get("/v1/products/category-metadata", params as Record<string, string | number | undefined>),
	};
}
