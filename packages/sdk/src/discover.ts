/**
 * `client.discover.*` — multi-listing ranking. flipagent's Overnight
 * pillar over HTTP. Pass an entire Browse search response, get back
 * deals sorted by margin × confidence.
 */

import type { DiscoverRequest, DiscoverResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface DiscoverClient {
	deals(req: DiscoverRequest): Promise<DiscoverResponse>;
}

export function createDiscoverClient(http: FlipagentHttp): DiscoverClient {
	return {
		deals: (req) => http.post("/v1/discover", req),
	};
}
