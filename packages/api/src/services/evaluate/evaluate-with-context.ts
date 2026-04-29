/**
 * Single source of "evaluate one listing, end-to-end". Three callers
 * share the same pre-flight:
 *
 *   1. enrich comparables + asks with `itemCreationDate`/`itemEndDate` so
 *      the hazard model can fit (sold-search and Browse search summaries
 *      omit start dates — they live only on detail).
 *   2. resolve the per-category fitted β when the observation archive
 *      has one (Phase 2 hosted moat); otherwise `evaluate()` falls back
 *      to the hardcoded category map in `categoryBeta()`.
 *   3. delegate to `evaluate()` with the enriched bundle.
 *
 * Used by:
 *   - `/v1/evaluate` route (per-listing evaluation)
 *   - `services/evaluate/discover-deals` (Discover ranking, Map over a search page)
 *   - `services/watchlists/scan` (watchlist scan worker)
 *
 * Async — enrichment may scrape detail pages.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { toLegacyId } from "../../utils/item-id.js";
import { fittedBetaFor } from "../calibration/beta-fit.js";
import { getItemDetail } from "../listings/detail.js";
import { evaluate } from "./evaluate.js";
import type { EvaluableItem, EvaluateOptions, Evaluation } from "./types.js";

async function enrichWithDuration<T extends ItemSummary>(items: ReadonlyArray<T>): Promise<T[]> {
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

export async function evaluateWithContext(item: EvaluableItem, opts: EvaluateOptions = {}): Promise<Evaluation> {
	const enrichedComps = opts.comparables ? await enrichWithDuration(opts.comparables) : undefined;
	const enrichedAsks = opts.asks ? await enrichWithDuration(opts.asks) : undefined;
	const categoryId = "categoryId" in item ? item.categoryId : undefined;
	const fittedBeta = categoryId ? await fittedBetaFor(categoryId).catch(() => undefined) : undefined;
	return evaluate(item, {
		...opts,
		comparables: enrichedComps,
		asks: enrichedAsks,
		beta: opts.beta ?? fittedBeta,
	});
}
