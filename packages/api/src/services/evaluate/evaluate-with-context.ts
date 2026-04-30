/**
 * One canonical scorer used by both pipelines:
 *
 *   - `/v1/evaluate`        → 1-item case (the seed)
 *   - `/v1/discover` (per cluster) → N-item case (cluster's actives)
 *
 * Both delegate into `discoverDeals` (the N-item ranker). evaluate's
 * 1-item path is just N=1 of the same function. This keeps a single
 * code path for fitted-β resolution + per-item `evaluate()` math, so
 * future ranking changes land in one place.
 *
 * Pre-flight (shared, both shapes):
 *   1. enrich sold + active listings with `itemCreationDate` / `itemEndDate`
 *      so the hazard model can fit (sold-search and Browse summaries
 *      omit start dates — they live only on detail). Items where the
 *      matcher already spliced dates (Option B) short-circuit.
 *   2. delegate to `discoverDeals`, which resolves per-category fitted β
 *      once and runs synchronous `evaluate()` per item.
 *
 * Async — enrichment may scrape detail pages.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { toLegacyId } from "../../utils/item-id.js";
import { getItemDetail } from "../listings/detail.js";
import { discoverDeals } from "./discover-deals.js";
import { evaluate } from "./evaluate.js";
import type { EvaluableItem, EvaluateOptions, Evaluation } from "./types.js";

/**
 * Pre-fill `itemCreationDate` / `itemEndDate` on listings whose summaries
 * came back without them — sold-search and Browse search both omit start
 * dates, but the hazard model needs them. Resolves to a new array with the
 * same shape; missing detail lookups silently leave the entry as-is.
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
 * `discoverDeals` — same enrichment + same fitted-β + same `evaluate()`
 * math, just N=1. Used by `/v1/evaluate` route. `discoverDeals` runs
 * the N-item path directly.
 */
export async function evaluateWithContext(item: EvaluableItem, opts: EvaluateOptions = {}): Promise<Evaluation> {
	const enrichedSold = opts.sold ? await enrichWithDuration(opts.sold) : opts.sold;
	const enrichedAsks = opts.asks ? await enrichWithDuration(opts.asks) : opts.asks;
	const ranked = await discoverDeals(
		{ itemSummaries: [item as ItemSummary], total: 1 },
		{ ...opts, sold: enrichedSold, asks: enrichedAsks },
	);
	// `discoverDeals` returns every input entry (no filtering), so a
	// 1-item input always yields a 1-item output. The fallback is a
	// belt-and-suspenders against future ranker changes.
	return ranked[0]?.evaluation ?? evaluate(item, { ...opts, sold: enrichedSold, asks: enrichedAsks });
}
