/**
 * `client.marketplaces.ebay.catalog.*` — eBay's product catalog mirror,
 * keyed on EPID. Distinct from `client.catalog` (flipagent's native
 * cross-marketplace catalog).
 */

import type {
	EbayCatalogListResponse,
	EbayCatalogMetadataForCategoriesQuery,
	EbayCatalogMetadataForCategoriesResponse,
	EbayCatalogMetadataQuery,
	EbayCatalogMetadataResponse,
	EbayCatalogProduct,
	EbayCatalogSearchQuery,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface EbayCatalogClient {
	get(epid: string): Promise<EbayCatalogProduct>;
	search(params: EbayCatalogSearchQuery): Promise<EbayCatalogListResponse>;
	metadata(params: EbayCatalogMetadataQuery): Promise<EbayCatalogMetadataResponse>;
	categoryMetadata(params: EbayCatalogMetadataForCategoriesQuery): Promise<EbayCatalogMetadataForCategoriesResponse>;
}

export function createEbayCatalogClient(http: FlipagentHttp): EbayCatalogClient {
	const base = "/v1/marketplaces/ebay/catalog";
	return {
		get: (epid) => http.get(`${base}/${encodeURIComponent(epid)}`),
		search: (params) => http.get(`${base}/search`, params as Record<string, string | number | undefined>),
		metadata: (params) => http.get(`${base}/metadata`, params as Record<string, string | number | undefined>),
		categoryMetadata: (params) =>
			http.get(`${base}/category-metadata`, params as Record<string, string | number | undefined>),
	};
}
