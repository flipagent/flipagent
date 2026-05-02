/**
 * `client.featured.*` — eBay's curated daily / event deals.
 */

import type { FeaturedListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface FeaturedClient {
	list(opts?: { kind?: "daily_deal" | "event_deal" }): Promise<FeaturedListResponse>;
}

export function createFeaturedClient(http: FlipagentHttp): FeaturedClient {
	return {
		list: (opts) => http.get("/v1/featured", opts?.kind ? { kind: opts.kind } : undefined),
	};
}
