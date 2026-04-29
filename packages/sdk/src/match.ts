/**
 * `client.match` — comp curation. Server-side two-pass LLM matcher
 * that classifies each pool listing as the same product as the
 * candidate or not. Strict — different model, finish, colour,
 * condition, or missing accessories all become `reject`.
 *
 * The host picks the LLM provider via env (Anthropic / OpenAI /
 * Google) — clients see the same response shape either way.
 *
 * Recommended sequence:
 *
 *   const pool = await client.sold.search({ q });
 *   const buckets = await client.match.pool({
 *     candidate,
 *     pool: pool.itemSales ?? [],
 *   });
 *   const comps = buckets.match.map((m) => m.item);
 *   const verdict = await client.evaluate.listing({
 *     item: candidate,
 *     opts: { comps },
 *   });
 *
 * `options.useImages` (default true) controls whether the matcher
 * inspects listing images. Disable for cheaper / faster runs.
 */

import type { MatchRequest, MatchResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MatchClient {
	/** Bucket pool items as match / reject against a candidate. */
	pool(req: MatchRequest): Promise<MatchResponse>;
}

export function createMatchClient(http: FlipagentHttp): MatchClient {
	return {
		pool: (req) => http.post("/v1/match", req),
	};
}
