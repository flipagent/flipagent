/**
 * Two-bucket classifier (`match` / `reject`) over a pool of `ItemSummary`.
 * Decision is delegated to an LLM that reads titles, structured aspects,
 * conditions, and (optionally) listing images. The deterministic
 * IDF-weighted token overlap of earlier versions has been retired —
 * it produced false negatives on listings whose sellers omitted the
 * reference number from the title.
 *
 * The matcher is intentionally strict. Any meaningful difference
 * (model number, finish, colour, condition, missing accessories) sends
 * the comparable to `reject`. Borderline / score-tuning is gone — the
 * decision is binary because the LLM has enough context to commit.
 *
 * Provider is one of Anthropic / OpenAI / Google — picked from env
 * (`LLM_PROVIDER` overrides; otherwise the first key set wins). The
 * matcher itself is provider-agnostic.
 *
 * The response cache (`/v1/match` keyed off candidate + sorted pool ids
 * + useImages) lives in this service, not in the route — watchlist
 * scans get the same hit-through behaviour as live HTTP callers.
 */

import type { MatchDelegateResponse, MatchOptions, MatchResponse } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { hashQuery } from "../shared/cache.js";
import type { FlipagentResult } from "../shared/result.js";
import { withCache } from "../shared/with-cache.js";
import { buildDelegatePrompt } from "./delegate.js";
import { isAnyLlmConfigured } from "./llm/index.js";
import { type LlmMatchDeps, matchPoolWithLlm } from "./matcher.js";
import { saveDelegateTrace } from "./trace.js";

const MATCH_PATH = "/v1/match";
const MATCH_TTL_SEC = 60 * 60 * 2;

export interface MatchPoolDeps extends LlmMatchDeps {}

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
		useImages: options.useImages ?? true,
	});
}

export type MatchPoolOutcome =
	| { mode: "hosted"; result: MatchPoolResult }
	| { mode: "delegate"; delegate: MatchDelegateResponse };

/**
 * Single entry point — branches on `options.mode`. Hosted runs the
 * two-pass LLM matcher with response cache; delegate builds a prompt
 * for the caller's LLM and persists the prompt-side trace context.
 *
 * Routes stay uniform: validate input → call this → render headers
 * (hosted) or return the delegate envelope. No layer-specific
 * branching at the route.
 */
export async function matchPool(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: MatchOptions,
	deps: MatchPoolDeps,
): Promise<MatchPoolOutcome> {
	if (options?.mode === "delegate") {
		const delegate = buildDelegatePrompt(candidate, pool, options);
		// Persist the prompt-side context for /v1/traces/match. Fire and
		// forget — a failed insert shouldn't block the response.
		void saveDelegateTrace({
			traceId: delegate.traceId,
			candidate,
			pool,
			useImages: options.useImages ?? true,
		}).catch((err) => console.error("[match.delegate] trace persist failed:", err));
		return { mode: "delegate", delegate };
	}

	if (!isAnyLlmConfigured()) {
		throw new MatchUnavailableError(
			"No LLM provider configured — /v1/match needs ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.",
		);
	}
	const queryHash = matchQueryHash(candidate, pool, options);
	const result = await withCache(
		// Hosted matcher can run for tens of seconds (parallel verify
		// chunks); give it a generous deadline that still bails before
		// an HTTP timeout would.
		{ scope: "match:hosted", ttlSec: MATCH_TTL_SEC, path: MATCH_PATH, queryHash, timeoutMs: 90_000 },
		async () => {
			const body = await matchPoolWithLlm(candidate, pool, options, deps);
			return { body, source: "llm" };
		},
	);
	return { mode: "hosted", result };
}

export type { ItemDetail };
