/**
 * `client.discover.*` — query-driven deal ranking. flipagent's
 * Overnight pillar over HTTP. Pass `q` (plus optional `categoryId` /
 * `filter` / `limit`) and the server runs the full pipeline (active
 * search → variant clustering → per-variant Evaluate run → rank).
 *
 * `clusters[]` is the result. Each cluster is one same-product-same-
 * variant group (canonical SKU + condition + size/grade/etc.) with the
 * full Evaluate-shape payload (item, soldPool, activePool, market,
 * evaluation, returns, meta). Sorted by representative's $/day desc.
 *
 * Callers decide what counts as a buyable recommendation — use
 * `isBuyable()` for the strict "positive-net + has recommendedExit"
 * reading, or render the raw list and let users see narrow-market
 * context (n<4 sold) too.
 */

import type { ComputeJobAck, DealCluster, DiscoverJob, DiscoverRequest, DiscoverResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface DiscoverJobsClient {
	create(req: DiscoverRequest): Promise<ComputeJobAck>;
	get(id: string): Promise<DiscoverJob>;
	cancel(id: string): Promise<ComputeJobAck>;
}

export interface DiscoverClient {
	deals(req: DiscoverRequest): Promise<DiscoverResponse>;
	jobs: DiscoverJobsClient;
}

export function createDiscoverClient(http: FlipagentHttp): DiscoverClient {
	return {
		deals: (req) => http.post("/v1/discover", req),
		jobs: {
			create: (req) => http.post("/v1/discover/jobs", req),
			get: (id) => http.get(`/v1/discover/jobs/${encodeURIComponent(id)}`),
			cancel: (id) => http.post(`/v1/discover/jobs/${encodeURIComponent(id)}/cancel`, {}),
		},
	};
}

/**
 * Strict "is this cluster a buyable deal?" predicate. True iff the
 * scorer produced a confident `recommendedExit` (n≥4 sold listings
 * backed it) AND the projected net is positive at that exit.
 *
 *   discover.deals(...).then(r => r.clusters.filter(isBuyable))
 *
 * Clusters failing this check still appear in the response — they
 * carry useful market context (median, sample size) for narrow SKUs
 * the UI may want to show. This helper just gives callers the strict
 * cut.
 */
export function isBuyable(c: DealCluster): boolean {
	const exit = c.evaluation.recommendedExit;
	return exit != null && exit.netCents > 0;
}
