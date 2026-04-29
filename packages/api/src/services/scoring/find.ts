import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { evaluate } from "./evaluate.js";
import type { DealVerdict, EvaluateOptions } from "./types.js";

export type RankedDeal = {
	itemId: string;
	verdict: DealVerdict;
};

/**
 * Score every entry in a search result against the same set of comps and
 * options, then return the deals sorted by **capital efficiency** —
 * `recommendedExit.dollarsPerDay`. Same metric `evaluate` itself
 * maximises when picking the optimal list price, so Discover's ranking
 * answers "where should my next $X go?" in the same units the optimizer
 * uses internally.
 *
 * Items without a recommendedExit (model couldn't run, or `evaluate`
 * couldn't compute one) sink to the bottom — they're not "deals" in any
 * actionable sense, but the caller may still want to see them. Active
 * searches populate `itemSummaries`; sold (Marketplace Insights)
 * searches populate `itemSales`. We accept either — but evaluating sold
 * listings as "deals" rarely makes sense; pass active results.
 */
export function find(results: BrowseSearchResponse, opts: EvaluateOptions = {}): ReadonlyArray<RankedDeal> {
	const items = results.itemSummaries ?? results.itemSales ?? [];
	return items
		.map((item) => ({ itemId: item.itemId, verdict: evaluate(item, opts) }))
		.filter((r) => r.verdict.recommendedExit && r.verdict.recommendedExit.netCents > 0)
		.sort((a, b) => {
			const yieldA = a.verdict.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
			const yieldB = b.verdict.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
			return yieldB - yieldA;
		});
}
