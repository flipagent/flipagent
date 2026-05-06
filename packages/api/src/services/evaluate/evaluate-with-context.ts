/**
 * One canonical scorer for `/v1/evaluate`. Delegates into
 * `rankCandidates` (the N-item ranker) with N=1, so per-item ranking
 * changes land in a single code path.
 *
 * Pre-flight: enrich sold + active listings with `itemCreationDate` /
 * `itemEndDate` so duration aggregates fit (sold-search and Browse
 * summaries omit start dates — they live only on detail). Items where
 * the matcher already spliced dates (Option B) short-circuit.
 *
 * Async — enrichment may scrape detail pages.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { toLegacyId } from "../../utils/item-id.js";
import { getItemDetail } from "../items/detail.js";
import { evaluate } from "./evaluate.js";
import { rankCandidates } from "./rank-candidates.js";
import type { EvaluableItem, EvaluateOptions, Evaluation } from "./types.js";

/**
 * Pre-fill `itemCreationDate` / `itemEndDate` on listings whose summaries
 * came back without them — sold-search and Browse search both omit start
 * dates, but the time-to-sell aggregator needs them. Resolves to a new
 * array with the same shape; missing detail lookups silently leave the
 * entry as-is.
 *
 * Items the matcher's verify pass already fetched detail for (Option B
 * splice) carry dates inline and short-circuit on the `if (creation &&
 * end)` check — no extra round-trip. Items decided by triage / decision-
 * cache hit fetch detail here through the standard 4h cached path.
 */
export async function enrichWithDuration<T extends ItemSummary>(items: ReadonlyArray<T>): Promise<T[]> {
	return Promise.all(
		items.map(async (item) => {
			if (item.itemCreationDate && item.itemEndDate) return item;
			const legacyId = toLegacyId(item);
			if (!legacyId) return item;
			const result = await getItemDetail(legacyId);
			const detail = result?.body;
			if (!detail) return item;
			const merged = { ...item } as T;
			if (!merged.itemCreationDate && detail.itemCreationDate) {
				merged.itemCreationDate = detail.itemCreationDate;
			}
			if (!merged.itemEndDate && detail.itemEndDate) {
				merged.itemEndDate = detail.itemEndDate;
			}
			return merged;
		}),
	);
}

/**
 * Score a single listing against a sold pool. Thin wrapper over
 * `rankCandidates` — same enrichment + same `evaluate()` math, just
 * N=1. Used by `/v1/evaluate` route.
 */
export async function evaluateWithContext(item: EvaluableItem, opts: EvaluateOptions = {}): Promise<Evaluation> {
	const enrichedSold = opts.sold ? await enrichWithDuration(opts.sold) : opts.sold;
	const enrichedAsks = opts.asks ? await enrichWithDuration(opts.asks) : opts.asks;
	const ranked = await rankCandidates(
		{ itemSummaries: [item as ItemSummary], total: 1 },
		{ ...opts, sold: enrichedSold, asks: enrichedAsks },
	);
	// `rankCandidates` returns every input entry (no filtering), so a
	// 1-item input always yields a 1-item output. The fallback is a
	// belt-and-suspenders against future ranker changes.
	return ranked[0]?.evaluation ?? evaluate(item, { ...opts, sold: enrichedSold, asks: enrichedAsks });
}
