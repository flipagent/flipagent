import type { MarketStats, QuantListing, Signal } from "../types.js";

/**
 * Primary signal. Active price meaningfully below the rolling sold median
 * for the same keyword. Strength increases as the discount grows.
 *
 * Default thresholds:
 *   - 0% discount → strength 0
 *   - 40% discount → strength 1
 * Caller may pass a custom `discountFloor` / `discountCeil`.
 */
export function underMedian(
	listing: QuantListing,
	market: MarketStats,
	options: { discountFloor?: number; discountCeil?: number } = {},
): Signal | null {
	if (market.medianCents <= 0) return null;
	const total = listing.priceCents + (listing.shippingCents ?? 0);
	const discount = 1 - total / market.medianCents;
	const floor = options.discountFloor ?? 0.0;
	const ceil = options.discountCeil ?? 0.4;
	if (discount <= floor) return null;
	const strength = Math.max(0, Math.min(1, (discount - floor) / (ceil - floor)));
	return {
		kind: "under_median",
		strength,
		reason: `total ${(total / 100).toFixed(2)} is ${(discount * 100).toFixed(1)}% below median ${(market.medianCents / 100).toFixed(2)}`,
	};
}
