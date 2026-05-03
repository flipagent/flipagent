/**
 * `client.marketplaces.*` — per-marketplace metadata.
 * Country-code is ISO-2 (`US`, `GB`, `DE`, …).
 *
 * `digitalSignatureRoutes()` removed — wrapped a non-existent eBay
 * endpoint (verified live 2026-05-02).
 */

import type { MarketplaceMetadata } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MarketplacesClient {
	get(country: string): Promise<MarketplaceMetadata>;
}

export function createMarketplacesClient(http: FlipagentHttp): MarketplacesClient {
	return {
		get: (country) => http.get(`/v1/marketplaces/${encodeURIComponent(country)}`),
	};
}
