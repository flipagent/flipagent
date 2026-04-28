import type { Listing, Signal } from "../types.js";

/**
 * Auction ending within the window with low watchers + zero bids. These
 * listings are statistically underpriced because the market hasn't found
 * them. Risk: seller may have reserve or end early.
 */
export function endingSoonLowWatchers(
	listing: Listing,
	now: Date = new Date(),
	options: { windowMs?: number; maxWatchers?: number } = {},
): Signal | null {
	if (listing.buyingFormat !== "AUCTION") return null;
	if (!listing.endTime) return null;
	const endMs = new Date(listing.endTime).getTime();
	if (Number.isNaN(endMs)) return null;
	const windowMs = options.windowMs ?? 60 * 60 * 1000;
	const remaining = endMs - now.getTime();
	if (remaining <= 0 || remaining > windowMs) return null;
	const maxWatchers = options.maxWatchers ?? 2;
	const watchers = listing.watchCount ?? 0;
	const bids = listing.bidCount ?? 0;
	if (watchers > maxWatchers || bids > 0) return null;
	const strength = 1 - remaining / windowMs;
	return {
		kind: "ending_soon_low_watchers",
		strength,
		reason: `auction ends in ${Math.round(remaining / 60000)}m with ${watchers} watchers, ${bids} bids`,
	};
}
