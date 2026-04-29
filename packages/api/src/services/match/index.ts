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
 * the comp to `reject`. Borderline / score-tuning is gone — the
 * verdict is binary because the LLM has enough context to commit.
 *
 * Provider is one of Anthropic / OpenAI / Google — picked from env
 * (`LLM_PROVIDER` overrides; otherwise the first key set wins). The
 * matcher itself is provider-agnostic.
 */

import type { MatchOptions, MatchResponse } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { isAnyLlmConfigured } from "./llm/index.js";
import { type LlmMatchDeps, matchPoolWithLlm } from "./matcher.js";

export interface MatchPoolDeps extends LlmMatchDeps {}

export class MatchUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MatchUnavailableError";
	}
}

export async function matchPool(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: MatchOptions,
	deps: MatchPoolDeps,
): Promise<MatchResponse> {
	if (!isAnyLlmConfigured()) {
		throw new MatchUnavailableError(
			"No LLM provider configured — /v1/match needs ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.",
		);
	}
	return matchPoolWithLlm(candidate, pool, options, deps);
}

export type { ItemDetail };
