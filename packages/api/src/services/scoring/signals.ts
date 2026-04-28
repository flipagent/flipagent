import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { signals } from "../quant/index.js";
import { marketFromComps, toQuantListing } from "./adapter.js";
import type { SignalHit } from "./types.js";

/**
 * Run every signal detector from `services/quant/signals` over the listing
 * and return the hits — without composing into a verdict. Useful when the
 * caller wants raw evidence to feed a custom scoring function.
 *
 * `brand-typo` is intentionally skipped here: it requires a known-brand list
 * supplied by the caller. Call `signals.brandTypo` directly when you have
 * one.
 */
export function signalsFor(item: ItemSummary, comps: ReadonlyArray<ItemSummary> = []): ReadonlyArray<SignalHit> {
	const listing = toQuantListing(item);
	const hits: SignalHit[] = [];

	if (comps.length > 0) {
		const market = marketFromComps(comps);
		const um = signals.underMedian(listing, market);
		if (um) hits.push({ name: um.kind, weight: um.strength, reason: um.reason });
	}

	const es = signals.endingSoonLowWatchers(listing);
	if (es) hits.push({ name: es.kind, weight: es.strength, reason: es.reason });

	const pt = signals.poorTitle(listing);
	if (pt) hits.push({ name: pt.kind, weight: pt.strength, reason: pt.reason });

	return hits;
}
