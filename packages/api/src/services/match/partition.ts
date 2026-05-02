/**
 * Split a matched-pool result back into its originating cohorts after a
 * combined-pool `matchPool` call. The composite intelligence flow
 * (`/v1/evaluate`) searches sold + active in parallel, dedupes into one
 * pool, runs a single LLM filter pass via `matchPool`, then needs to
 * route the kept items back to the right argument:
 *
 *   matched ∩ rawSoldIds   →  sold    (price reference)
 *   matched ∖ rawSoldIds   →  active  (competition)
 *
 * Pure function. The caller owns the search and the matchPool call;
 * this just owns the bucket-routing math so it doesn't get re-coded
 * twice.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";

export function partitionMatched(
	matched: ReadonlyArray<ItemSummary>,
	rawSoldIds: ReadonlySet<string>,
): { sold: ItemSummary[]; active: ItemSummary[] } {
	const sold: ItemSummary[] = [];
	const active: ItemSummary[] = [];
	for (const item of matched) {
		if (rawSoldIds.has(item.itemId)) sold.push(item);
		else active.push(item);
	}
	return { sold, active };
}
