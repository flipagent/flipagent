/**
 * Listing-quality primitives: a 0..1 confidence score and a hard-veto
 * predicate. Used by `score()` to gate / discount the deal valuation.
 */

import type { Listing } from "./types.js";

const FEEDBACK_FLOOR = 50;
const FEEDBACK_CEIL = 5000;
const PHOTOS_FLOOR = 1;
const PHOTOS_CEIL = 8;
const DESC_FLOOR = 50;
const DESC_CEIL = 1000;

function clamp01(x: number): number {
	if (Number.isNaN(x)) return 0;
	if (x < 0) return 0;
	if (x > 1) return 1;
	return x;
}

function logScale(value: number, floor: number, ceil: number): number {
	if (value <= floor) return 0;
	if (value >= ceil) return 1;
	return Math.log(value - floor + 1) / Math.log(ceil - floor + 1);
}

/**
 * 0..1 multiplier. Combines:
 *   - seller feedback count (log-scaled, floor 50, ceil 5000)
 *   - seller feedback percent (must be ≥ 95% to contribute)
 *   - image count (linear, floor 1, ceil 8)
 *   - description length (log-scaled, floor 50, ceil 1000)
 *
 * Each component independently maps to 0..1; the result is the product.
 * That makes a single very-bad signal (e.g. brand-new seller) zero out the
 * confidence — which is the desired behavior.
 */
export function confidence(listing: Listing): number {
	const feedback = logScale(listing.sellerFeedback ?? 0, FEEDBACK_FLOOR, FEEDBACK_CEIL);
	const feedbackPct = (listing.sellerFeedbackPercent ?? 0) >= 95 ? 1 : 0;
	const photos = logScale(listing.imageCount ?? 0, PHOTOS_FLOOR, PHOTOS_CEIL);
	const desc = logScale(listing.descriptionLength ?? 0, DESC_FLOOR, DESC_CEIL);
	const product = feedback * feedbackPct * Math.max(photos, 0.1) * Math.max(desc, 0.1);
	return clamp01(product);
}

/**
 * Hard veto. If any of these are true, the listing is too risky to score.
 * Returns the violated rule name, or null when safe.
 */
export function veto(listing: Listing): string | null {
	if ((listing.sellerFeedback ?? 0) < FEEDBACK_FLOOR) return "seller_feedback_too_low";
	if (listing.condition && /for parts|not working/i.test(listing.condition)) return "broken_condition";
	if (/^[A-Z\s\d!?.]{15,}$/.test(listing.title)) return "all_caps_title";
	return null;
}
