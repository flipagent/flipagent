/**
 * `client.featured.*` — eBay-curated buy-side surfaces:
 * daily/event deals, merchandised products, also-bought, also-viewed.
 */

import type {
	FeaturedListResponse,
	MerchandisedProductsQuery,
	MerchandisedProductsResponse,
	RelatedByProductQuery,
	RelatedByProductResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface FeaturedClient {
	list(opts?: { kind?: "daily_deal" | "event_deal" }): Promise<FeaturedListResponse>;
	merchandised(query: MerchandisedProductsQuery): Promise<MerchandisedProductsResponse>;
	alsoBought(query: RelatedByProductQuery): Promise<RelatedByProductResponse>;
	alsoViewed(query: RelatedByProductQuery): Promise<RelatedByProductResponse>;
}

export function createFeaturedClient(http: FlipagentHttp): FeaturedClient {
	return {
		list: (opts) => http.get("/v1/featured", opts?.kind ? { kind: opts.kind } : undefined),
		merchandised: (query) =>
			http.get("/v1/featured/merchandised", query as Record<string, string | number | undefined>),
		alsoBought: (query) => http.get("/v1/featured/also-bought", query as Record<string, string | number | undefined>),
		alsoViewed: (query) => http.get("/v1/featured/also-viewed", query as Record<string, string | number | undefined>),
	};
}
