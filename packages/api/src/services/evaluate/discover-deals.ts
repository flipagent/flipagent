import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { fittedBetaFor } from "../calibration/beta-fit.js";
import { evaluate } from "./evaluate.js";
import type { EvaluateOptions, Evaluation } from "./types.js";

export type RankedDeal = {
	itemId: string;
	evaluation: Evaluation;
};

/**
 * Canonical N-item ranker. Single source of truth for "score these
 * actives against this sold pool, return them ranked." Used by:
 *
 *   - `/v1/discover` (per-cluster, N=cluster.items)
 *   - `/v1/evaluate` via `evaluateWithContext` (N=1 thin wrapper)
 *
 * Returns ALL evaluated entries — sorted by capital efficiency
 * (`recommendedExit.dollarsPerDay`) with nullish/negative-net entries
 * sinking to the bottom. The caller decides what counts as a buyable
 * deal (e.g. UI cuts at first nullish exit, or filters by `netCents > 0`
 * via the SDK's `isBuyable` helper); the ranker just ranks.
 *
 * Returning the unfiltered list lets narrow markets (n=1..3 sold, where
 * `evaluate()` can't compute a confident `recommendedExit`) still
 * surface their candidates with median + nObservations attached, so the
 * UI can render market context even when ranking is weak.
 *
 * Active searches populate `itemSummaries`; sold (Marketplace Insights)
 * populate `itemSales`. Evaluating sold listings as "deals" rarely
 * makes sense — pass active results.
 *
 * **Pool enrichment is the caller's responsibility.** Both pipelines
 * (evaluate + discover) call `enrichWithDuration(sold)` and
 * `enrichWithDuration(asks)` upstream so the hazard model gets full
 * date coverage. The matcher's verify pass already splices dates into
 * items it fetched detail for (Option B), so most items short-circuit
 * the enrichment fetch.
 *
 * Per-candidate work is synchronous `evaluate()` math, no IO.
 */
export async function discoverDeals(
	results: BrowseSearchResponse,
	opts: EvaluateOptions = {},
): Promise<ReadonlyArray<RankedDeal>> {
	const items = results.itemSummaries ?? results.itemSales ?? [];
	if (items.length === 0) return [];

	// Resolve fitted-β once per unique categoryId. Most active search
	// results share a category, so this collapses 50 lookups to 1 in the
	// typical case.
	const uniqueCategoryIds = Array.from(
		new Set(items.map((i) => ("categoryId" in i ? i.categoryId : undefined)).filter((c): c is string => !!c)),
	);
	const betaByCategory = new Map<string, number | undefined>();
	await Promise.all(
		uniqueCategoryIds.map(async (cid) => {
			const b = await fittedBetaFor(cid).catch(() => undefined);
			betaByCategory.set(cid, b);
		}),
	);

	const ranked = items.map((item) => {
		const categoryId = "categoryId" in item ? item.categoryId : undefined;
		const beta = categoryId ? betaByCategory.get(categoryId) : undefined;
		const evaluation = evaluate(item, { ...opts, beta: opts.beta ?? beta });
		return { itemId: item.itemId, evaluation };
	});

	return ranked.sort((a, b) => {
		const yieldA = a.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
		const yieldB = b.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
		return yieldB - yieldA;
	});
}
