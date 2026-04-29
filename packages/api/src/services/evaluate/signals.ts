import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { signals } from "../quant/index.js";
import { marketFromComparables, toQuantListing } from "./adapter.js";
import type { FiredSignal } from "./types.js";

/**
 * Run every signal detector from `services/quant/signals` over the listing
 * and return the hits — without composing into an evaluation. Useful when the
 * caller wants raw evidence to feed a custom scoring function.
 *
 * `brand-typo` is intentionally skipped here: it requires a known-brand list
 * supplied by the caller. Call `signals.brandTypo` directly when you have
 * one.
 */
export function extractSignals(
	item: ItemSummary,
	comparables: ReadonlyArray<ItemSummary> = [],
): ReadonlyArray<FiredSignal> {
	const listing = toQuantListing(item);
	const hits: FiredSignal[] = [];

	if (comparables.length > 0) {
		const market = marketFromComparables(comparables);
		const um = signals.underMedian(listing, market);
		if (um) hits.push({ name: um.kind, weight: um.strength, reason: um.reason });
	}

	const es = signals.endingSoonLowWatchers(listing);
	if (es) hits.push({ name: es.kind, weight: es.strength, reason: es.reason });

	const pt = signals.poorTitle(listing);
	if (pt) hits.push({ name: pt.kind, weight: pt.strength, reason: pt.reason });

	return hits;
}
