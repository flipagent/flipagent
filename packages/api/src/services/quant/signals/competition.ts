import type { MarketStats, QuantListing, Signal } from "../types.js";

/**
 * Fires when this listing's price sits at or below the 25th percentile
 * of currently-active asks for the same SKU. The buyer gets one of the
 * cheapest active examples on the market right now → a strong sourcing
 * signal independent of sold-side comparables.
 *
 * Requires `market.asks` (call `summarizeAsks` on active listings and
 * pass into `MarketStats`). Returns null when asks are missing or when
 * the listing's price is above asks.p25.
 */
export function belowAsks(listing: QuantListing, market: MarketStats): Signal | null {
	const asks = market.asks;
	if (!asks || asks.nActive === 0) return null;
	const cost = listing.priceCents + (listing.shippingCents ?? 0);
	if (cost > asks.p25Cents) return null;
	// Strength scales with how far below p25 we are, capped at p25 → median spread.
	const spread = Math.max(1, asks.medianCents - asks.p25Cents);
	const distance = Math.max(0, asks.p25Cents - cost);
	const strength = Math.min(1, distance / spread);
	return {
		kind: "below_asks",
		strength,
		reason: `priced at $${(cost / 100).toFixed(2)} — at or under p25 of ${asks.nActive} active asks (median $${(
			asks.medianCents / 100
		).toFixed(2)})`,
	};
}
