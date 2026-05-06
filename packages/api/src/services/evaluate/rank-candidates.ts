import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { evaluate } from "./evaluate.js";
import type { EvaluateOptions, Evaluation } from "./types.js";

export type RankedCandidate = {
	itemId: string;
	evaluation: Evaluation;
};

/**
 * Canonical N-item ranker. Single source of truth for "score these
 * actives against this sold pool, return them ranked." Used by
 * `/v1/evaluate` via `evaluateWithContext` (N=1 thin wrapper).
 *
 * Returns ALL evaluated entries — sorted by capital efficiency
 * (`recommendedExit.dollarsPerDay`) with nullish/negative-net entries
 * sinking to the bottom. The caller decides what counts as a buyable
 * candidate (e.g. UI cuts at first nullish exit, or filters by
 * `netCents > 0` via the SDK's `isBuyable` helper); the ranker just
 * ranks.
 *
 * Returning the unfiltered list lets narrow markets (n=1..3 sold, where
 * `evaluate()` can't compute a confident `recommendedExit`) still
 * surface their candidates with median + nObservations attached, so the
 * UI can render market context even when ranking is weak.
 *
 * Active searches populate `itemSummaries`; sold (Marketplace Insights)
 * populate `itemSales`. Evaluating sold listings rarely makes sense —
 * pass active results.
 *
 * **Pool enrichment is the caller's responsibility.** The pipeline
 * calls `enrichWithDuration(sold)` and `enrichWithDuration(asks)`
 * upstream so the hazard model gets full date coverage. The matcher's
 * verify pass already splices dates into items it fetched detail for
 * (Option B), so most items short-circuit the enrichment fetch.
 *
 * Per-candidate work is synchronous `evaluate()` math, no IO.
 */
export async function rankCandidates(
	results: BrowseSearchResponse,
	opts: EvaluateOptions = {},
): Promise<ReadonlyArray<RankedCandidate>> {
	const items = results.itemSummaries ?? results.itemSales ?? [];
	if (items.length === 0) return [];

	const ranked = items.map((item) => ({
		itemId: item.itemId,
		evaluation: evaluate(item, opts),
	}));

	return ranked.sort((a, b) => {
		const yieldA = a.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
		const yieldB = b.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
		return yieldB - yieldA;
	});
}
