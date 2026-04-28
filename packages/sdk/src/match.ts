/**
 * `client.match` — comp curation. Three-bucket classifier over a pool
 * of listings against a candidate. Distinct from `evaluate` (margin
 * verdict) and `research` (statistics): match answers "are these the
 * same product?", deterministically and without an LLM.
 *
 * Recommended sequence around it:
 *
 *   const pool = await client.sold.search({ q });
 *   const buckets = await client.match.pool({ candidate, pool: pool.itemSales ?? [] });
 *   // host LLM inspects each `buckets.borderline` (fetch detail, compare
 *   // aspects + image), keeps or drops
 *   const comps = [...buckets.match.map(m => m.item), ...keptBorderlines];
 *   const verdict = await client.evaluate.listing({ item: candidate, opts: { comps } });
 */

import type { MatchRequest, MatchResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MatchClient {
	/** Bucket pool items as match / borderline / reject against a candidate. */
	pool(req: MatchRequest): Promise<MatchResponse>;
}

export function createMatchClient(http: FlipagentHttp): MatchClient {
	return {
		pool: (req) => http.post("/v1/match", req),
	};
}
