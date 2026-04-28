import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { evaluate } from "./evaluate.js";
import type { DealVerdict, EvaluateOptions } from "./types.js";

export type RankedDeal = {
	itemId: string;
	verdict: DealVerdict;
};

/**
 * Score every entry in a search result against the same set of comps and
 * options, then return only the deals (`verdict.isDeal === true`) sorted by
 * expected take-home: `netCents × confidence`.
 *
 * Active searches populate `itemSummaries`; sold (Marketplace Insights)
 * searches populate `itemSales`. We accept either — but evaluating sold
 * listings as "deals" rarely makes sense; pass active results.
 */
export function find(results: BrowseSearchResponse, opts: EvaluateOptions = {}): ReadonlyArray<RankedDeal> {
	const items = results.itemSummaries ?? results.itemSales ?? [];
	return items
		.map((item) => ({ itemId: item.itemId, verdict: evaluate(item, opts) }))
		.filter((r) => r.verdict.isDeal)
		.sort((a, b) => {
			const scoreA = a.verdict.netCents * a.verdict.confidence;
			const scoreB = b.verdict.netCents * b.verdict.confidence;
			return scoreB - scoreA;
		});
}
