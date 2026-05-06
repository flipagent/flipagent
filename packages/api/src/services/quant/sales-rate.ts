/**
 * Velocity helpers — per-listing rate derivation and the asymmetric
 * blend that folds it into a comp-pool rate. Pure functions; no I/O,
 * no shape adapters. Called from `evaluate/adapter.ts` (for the seed
 * listing's PDP signals) and exposed for unit-testing.
 */

/**
 * Cap on the per-listing rate window. eBay PDPs surface a rolling sold
 * count (not lifetime since first listed), and GTC listings auto-renew
 * every 30 days. Beyond ~60 days the `soldQuantity / days_since_creation`
 * rate increasingly understates current velocity. The cap is conservative
 * — slightly overestimates for very-old listings (when the true window
 * is < days_since_creation), never undershoots.
 */
const MAX_SEED_WINDOW_DAYS = 60;

/**
 * Per-listing sales rate from a multi-quantity listing's own metadata.
 * Returns null when there's nothing usable to compute from:
 *
 *   - `soldQuantity` missing or zero  → no demand signal yet
 *   - `createdAt` missing             → can't compute a window
 *   - listing < 1 day old             → unstable rate (one sale could
 *                                        read as 24/day at half a day)
 */
export function seedListingRate(
	soldQuantity: number | null | undefined,
	createdAt: string | null | undefined,
): number | null {
	if (!soldQuantity || soldQuantity <= 0) return null;
	if (!createdAt) return null;
	const ts = Date.parse(createdAt);
	if (!Number.isFinite(ts)) return null;
	const days = (Date.now() - ts) / 86_400_000;
	if (!Number.isFinite(days) || days < 1) return null;
	return soldQuantity / Math.min(days, MAX_SEED_WINDOW_DAYS);
}

/**
 * Blend the comp-pool sales rate with a seed listing's per-listing
 * rate. Asymmetric — seed evidence can RAISE the effective rate but
 * never lower it.
 *
 *   seedRate <= marketRate  → marketRate                     (no-op)
 *   seedRate >  marketRate  → sqrt(marketRate × seedRate)    (geometric)
 *   marketRate == 0         → seedRate                       (niche fallback)
 *
 * Geometric-mean dampening on the upside — a seed at 20× the market
 * rate doesn't catapult the forecast to 20× (we'll be a different
 * seller, so the seed is evidence, not certainty); sqrt-growth keeps
 * the bump proportional. Floor at marketRate because the seed's slow
 * sell-through could be price/ranking/seller-rep specific to that
 * seller — none of which constrain our resold listing.
 *
 * `marketRate = 0` is the niche-SKU path: when the comp pool produced
 * no velocity at all (typical for freshly-discovered SKUs), the
 * geometric mean would collapse to zero and waste the seed signal.
 * Return the seed rate directly — it's literally the only evidence.
 */
export function blendSalesPerDay(marketRate: number, seedRate: number | null): number {
	if (seedRate == null || seedRate <= marketRate) return marketRate;
	if (marketRate <= 0) return seedRate;
	return Math.sqrt(marketRate * seedRate);
}
