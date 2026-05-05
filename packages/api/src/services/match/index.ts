/**
 * Same-product classifier — internal-only. Used by composite
 * intelligence pipelines (`/v1/evaluate`, watchlists/scan) to filter
 * raw search pools down to listings that describe the same product as
 * the seed item.
 *
 * Two-bucket output (`match` / `reject`). Decision is delegated to an
 * LLM that reads titles, structured aspects, conditions, and
 * (optionally) listing images. The matcher is intentionally strict —
 * any meaningful difference (model number, finish, colour, condition,
 * missing accessories) sends the listing to `reject`.
 *
 * Provider is one of Anthropic / OpenAI / Google — picked from env
 * (`LLM_PROVIDER` overrides; otherwise the first key set wins). When no
 * provider is configured, `matchPool` throws `MatchUnavailableError`
 * and callers fall back to the unfiltered pool.
 *
 * The response cache (keyed off candidate + sorted pool ids + useImages)
 * lives in this service so every internal caller gets the same hit-through
 * behaviour.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { hashQuery } from "../shared/cache.js";
import type { FlipagentResult } from "../shared/result.js";
import { withCache } from "../shared/with-cache.js";
import { isAnyLlmConfigured } from "./llm/index.js";
import { type DetailFetcher, type MatchProgress, matchPoolWithLlm } from "./matcher.js";
import type { MatchOptions, MatchResponse } from "./types.js";

export type { DetailFetcher, MatchProgress } from "./matcher.js";

const MATCH_PATH = "internal:match";
const MATCH_TTL_SEC = 60 * 60 * 2;

export type MatchPoolResult = FlipagentResult<MatchResponse>;

export class MatchUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MatchUnavailableError";
	}
}

function matchQueryHash(candidate: ItemSummary, pool: ReadonlyArray<ItemSummary>, options: MatchOptions): string {
	// Pool ids are sorted so the hash is order-independent — same triple
	// (candidate, pool set, useImages) maps to one cached decision.
	const poolIds = pool
		.map((p) => p.itemId)
		.sort()
		.join(",");
	return hashQuery({
		candidate: candidate.itemId,
		pool: poolIds,
		useImages: options.useImages ?? false,
	});
}

/**
 * Run the LLM matcher over `pool` against `candidate`. Independent
 * module: depends only on its own decision cache + an LLM provider +
 * the caller-supplied detail-fetch port. The matcher knows nothing
 * about eBay transport, auth, or tier limits.
 *
 * Wraps the whole call in the response cache so identical (candidate,
 * pool) hits are instant. The 30-day decision cache short-circuits
 * per-pair work even on cold (candidate, pool) combinations.
 *
 * Throws `MatchUnavailableError` when no LLM provider is configured —
 * composite callers catch this and fall back to the unfiltered pool so
 * endpoints stay up on self-host without a key.
 */
export async function matchPool(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: MatchOptions,
	fetchDetail: DetailFetcher,
	onProgress?: (p: MatchProgress) => void,
): Promise<MatchPoolResult> {
	if (!isAnyLlmConfigured()) {
		throw new MatchUnavailableError(
			"No LLM provider configured — set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.",
		);
	}
	const queryHash = matchQueryHash(candidate, pool, options);
	return withCache(
		// Matcher can run for tens of seconds (parallel verify chunks);
		// give it a generous deadline that still bails before an HTTP
		// timeout would.
		{ scope: "match:hosted", ttlSec: MATCH_TTL_SEC, path: MATCH_PATH, queryHash, timeoutMs: 90_000 },
		async () => {
			// `onProgress` only fires on cache miss (the inner closure).
			// Cache hits return instantly, so the UI just sees the filter
			// step transition started → succeeded with no progress events,
			// which is the desired behavior.
			const body = await matchPoolWithLlm(candidate, pool, options, fetchDetail, onProgress);
			return { body, source: "llm" };
		},
	);
}

export type { ItemDetail };
