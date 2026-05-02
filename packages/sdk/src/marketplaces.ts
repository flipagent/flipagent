/**
 * `client.marketplaces.*` — per-marketplace metadata + digital-signature
 * routes. Country-code is ISO-2 (`US`, `GB`, `DE`, …).
 */

import type { DigitalSignatureRoutesResponse, MarketplaceMetadata } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MarketplacesClient {
	get(country: string): Promise<MarketplaceMetadata>;
	digitalSignatureRoutes(country: string): Promise<DigitalSignatureRoutesResponse>;
}

export function createMarketplacesClient(http: FlipagentHttp): MarketplacesClient {
	return {
		get: (country) => http.get(`/v1/marketplaces/${encodeURIComponent(country)}`),
		digitalSignatureRoutes: (country) =>
			http.get(`/v1/marketplaces/${encodeURIComponent(country)}/digital-signature`),
	};
}
