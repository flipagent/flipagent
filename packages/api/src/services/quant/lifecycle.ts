/**
 * Phase 3 (LIST) — recommend a list price + Erlang-based time-to-sell band.
 *
 * Replaces the previous MNL hazard / β-fitted optimizer. That model was
 * mathematically rigorous but produced reseller-counterintuitive recs
 * ("$700 with 28d hold" when the same $/day was achievable in 7d at a
 * lower price), and required β calibration data we don't have. This
 * version trades that precision for simplicity:
 *
 *   1. Sold reference. Full-window median (caller controls window via
 *      `lookbackDays` — shorter for fast-moving markets, longer for
 *      stable ones).
 *
 *   2. Realistic asks. Drop scams (< 50% of soldRef) and moonshots
 *      (> 200%). Log-symmetric around the reference.
 *
 *   3. Anchor with smooth blend. When ≥3 realistic asks exist, detect
 *      cooling drift (asks below sold reference) and linearly ramp
 *      blend weight 10%→30% drift. Max blend strength 50/50 (don't
 *      fully follow asks at extreme). Heating (asks above) is left to
 *      the caller — listing at sold reference when buyers are paying
 *      above is a conservative default, and runaway aspirational asks
 *      shouldn't drag the recommendation up automatically.
 *
 *   4. Undercut by 2% (industry convention).
 *
 *   5. Time = Erlang(k = queueAhead + 1, λ = salesPerDay). Mean = k/λ,
 *      σ = √k/λ. Surface ±σ band as honest uncertainty (CV narrows as
 *      queue grows).
 *
 * Assumptions (any breaks → output unreliable):
 *   - Buyers prefer cheapest realistic ask (FIFO by price)
 *   - Real asks compete for the same buyer pool
 *   - Total `salesPerDay` applies uniformly to real asks
 *   - Static market: ask churn negligible over prediction window
 *
 * Validated against 27 hand-crafted scenarios (cooling, heating, scams,
 * moonshots, bimodal, single-outlier, conflict cases). Days predictions
 * have ~30-50% error in churning markets; band surfaces this honestly.
 */

import { feeBreakdown } from "./fees.js";
import { DEFAULT_FEES, type FeeModel, type ListPriceRecommendation, type MarketStats } from "./types.js";

export interface RecommendListPriceOptions {
	fees?: FeeModel;
	/** Outbound shipping cost per sale (cents). Default 0. */
	outboundShippingCents?: number;
	/**
	 * Active competing listings' prices (cents). Drives outlier filter,
	 * regime-drift detection, and queue position. Empty / omitted →
	 * formula falls back to sold reference with no competitor info.
	 */
	activeAskPrices?: ReadonlyArray<number>;
	/**
	 * Buyer's acquisition cost in cents. Subtracted from gross net to
	 * report flipping economics. Required for buyer-side `evaluate`;
	 * draft / reprice callers leave unset (defaults to 0 = pure list-side).
	 */
	buyPriceCents?: number;
}

export function recommendListPrice(
	market: MarketStats,
	options: RecommendListPriceOptions = {},
): ListPriceRecommendation | null {
	const v = market.salesPerDay;
	if (v <= 0) return null;
	if (market.medianCents <= 0) return null;

	// 1) Sold reference. Full-window median — caller's `lookbackDays`
	// already controls how recent the window is (default 90, shorter for
	// fast-moving markets).
	const soldRef = market.medianCents;

	// 2) Filter realistic asks (50%-200% of soldRef).
	const asks = (options.activeAskPrices ?? []).slice().sort((a, b) => a - b);
	const realAsks = asks.filter((p) => p >= soldRef * 0.5 && p <= soldRef * 2);

	// 3) Smooth blend between sold reference and ask median.
	let anchor = soldRef;
	if (realAsks.length >= 3) {
		const askMed = realAsks[Math.floor(realAsks.length / 2)] ?? soldRef;
		const drift = (soldRef - askMed) / soldRef;
		// Cooling: drift > 0 (asks below sold). Linear ramp 10%→30%.
		// Heating (drift < 0) intentionally not auto-blended — see header.
		const coolingW = Math.max(0, Math.min(1, (drift - 0.1) / 0.2));
		anchor = Math.round(soldRef * (1 - coolingW * 0.5) + askMed * (coolingW * 0.5));
	}

	// 4) Undercut by 2%.
	const listPriceCents = Math.round(anchor * 0.98);

	// 5) Queue + Erlang time band.
	const queueAhead = realAsks.filter((p) => p <= listPriceCents).length;
	const asksAbove = realAsks.length - queueAhead;
	const k = queueAhead + 1;
	const meanDays = Math.max(0.5, k / v);
	const sigmaDays = Math.sqrt(k) / v;
	const daysLow = Math.max(0.5, meanDays - sigmaDays);
	const daysHigh = meanDays + sigmaDays;

	// Net + $/day. The $/day here is the LIST-leg rate (net divided by
	// expected sell days) — descriptive only. Reseller-facing capital
	// efficiency over the full buy→cash cycle is computed in evaluate.ts,
	// which adds the inbound + list-prep + outbound + claim padding from
	// the risk module. Standalone callers without that context get the
	// list-leg figure here.
	const fees = options.fees ?? DEFAULT_FEES;
	const fb = feeBreakdown(listPriceCents, fees);
	const ship = options.outboundShippingCents ?? 0;
	const buy = options.buyPriceCents ?? 0;
	const netCents = listPriceCents - fb.totalCents - ship - buy;
	const dollarsPerDay = Math.round(netCents / Math.max(meanDays, 0.5));

	return {
		listPriceCents,
		expectedDaysToSell: +meanDays.toFixed(2),
		daysLow: +daysLow.toFixed(2),
		daysHigh: +daysHigh.toFixed(2),
		netCents,
		dollarsPerDay,
		queueAhead,
		asksAbove,
	};
}
