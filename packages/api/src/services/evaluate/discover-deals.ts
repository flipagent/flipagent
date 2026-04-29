import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { evaluateWithContext } from "./evaluate-with-context.js";
import type { EvaluateOptions, Evaluation } from "./types.js";

export type RankedDeal = {
	itemId: string;
	evaluation: Evaluation;
};

/**
 * Score every entry in a search result against the same set of comparables and
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
 *
 * Async because each candidate runs through `evaluateWithContext`, which
 * may scrape detail pages to enrich comparables with start/end dates.
 */
export async function discoverDeals(
	results: BrowseSearchResponse,
	opts: EvaluateOptions = {},
): Promise<ReadonlyArray<RankedDeal>> {
	const items = results.itemSummaries ?? results.itemSales ?? [];
	const ranked = await Promise.all(
		items.map(async (item) => ({ itemId: item.itemId, evaluation: await evaluateWithContext(item, opts) })),
	);
	return ranked
		.filter((r) => r.evaluation.recommendedExit && r.evaluation.recommendedExit.netCents > 0)
		.sort((a, b) => {
			const yieldA = a.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
			const yieldB = b.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
			return yieldB - yieldA;
		});
}
