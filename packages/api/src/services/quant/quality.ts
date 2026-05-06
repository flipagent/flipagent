/**
 * Listing-quality hard veto. Returns the violated rule name, or null
 * when the listing clears the bar.
 *
 * Only factual condition flags drive vetoes now — "for parts" /
 * "not working" listings are non-flips, period. Heuristic vetoes
 * (seller feedback floors, all-caps title penalties) were removed:
 * marketplace-specific, hard to defend across categories, and prone
 * to false positives when scrape data is incomplete.
 */

import type { QuantListing } from "./types.js";

export function veto(listing: QuantListing): string | null {
	if (listing.condition && /for parts|not working/i.test(listing.condition)) return "broken_condition";
	return null;
}
