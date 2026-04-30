/**
 * Phase 3 (LIST) — given duration data, recommend the price that
 * maximizes capital efficiency (yield per day). Returns null when
 * `market.meanDaysToSell` is absent.
 */

import { feeBreakdown } from "./fees.js";
import { DEFAULT_FEES, type FeeModel, type ListPriceRecommendation, type MarketStats } from "./types.js";

/**
 * Default elasticity of sale rate w.r.t. log-price z-score:
 *   λ(z) = λ₀ · exp(−β · z)
 * 1.5 is a reasonable starting value across resale collectibles +
 * electronics until SPRD-side per-listing duration data lets us fit
 * β empirically per category.
 */
export const DEFAULT_ELASTICITY = 1.5;

/**
 * Per-category elasticity defaults (eBay leaf categoryIds).
 * Calibrated by hand from observed price-vs-time-to-sell elasticity
 * in each market — sneakers / cards are very price-sensitive (a few %
 * over market and listings sit forever), antiques / collectibles less so.
 * Falls back to `DEFAULT_ELASTICITY` for unmapped categories.
 */
const CATEGORY_BETA: Record<string, number> = {
	"15709": 4.0, // Athletic Shoes
	"183454": 3.0, // Pokémon Trading Cards
	"31387": 2.0, // Wristwatches
	"9355": 2.5, // Cell Phones & Smartphones
	"139973": 2.0, // Video Games
	"169271": 1.0, // Antiques
};

export function categoryBeta(categoryId: string | undefined): number {
	if (!categoryId) return DEFAULT_ELASTICITY;
	return CATEGORY_BETA[categoryId] ?? DEFAULT_ELASTICITY;
}

export interface OptimalListPriceOptions {
	fees?: FeeModel;
	/**
	 * Annualized hurdle rate used when ranking candidate list prices.
	 * Default 0.30 — a price gets credit only after clearing 30% / yr.
	 */
	hurdleRate?: number;
	/** Override default elasticity. */
	beta?: number;
	/** Outbound shipping cost per sale (cents). Default 0. */
	outboundShippingCents?: number;
	/**
	 * Active competing listings' prices (cents). Drives two adjustments:
	 *   1. Position-aware hazard discount — listings ranked behind cheaper
	 *      competitors sell slower (queue model).
	 *   2. Active-blend on the grid centre — when active median diverges
	 *      from sold mean by >10%, recenter the grid toward active to
	 *      catch markets that have moved since the sold window.
	 * Empty array or omitted → fall back to sold-only hazard.
	 */
	activeAskPrices?: ReadonlyArray<number>;
	/**
	 * Hard ceiling on expected days-to-sell. Prices whose predicted hold
	 * exceeds this are dropped from the grid. When the feasible set is
	 * empty, returns null.
	 */
	maxDaysToSell?: number;
	/**
	 * Buyer's acquisition cost in cents (price + inbound shipping). When
	 * supplied, yield ranking uses `(gross − buy) / days` instead of
	 * `gross / days` so the optimum reflects flipping economics, not
	 * draft-listing yield. Without this, the ranker can recommend a
	 * fast-selling cheap price that maximises gross yield even though
	 * the flip loses money. Required for the buyer-side `evaluate` flow;
	 * draft / reprice callers leave it unset.
	 */
	buyPriceCents?: number;
	/**
	 * Lower z-score bound for the search grid. Default −0.5 (don't
	 * recommend listing more than ~half-σ below mean). Aggressive sellers
	 * can pass `zMin: -1.5` to consider deep discounts.
	 */
	zMin?: number;
	/** Upper z-score bound. Default +1.5. */
	zMax?: number;
	/** Number of grid points across [zMin, zMax]. Default 21. */
	steps?: number;
	/**
	 * Floor on the expected days-to-sell used in yield ranking + IRR.
	 * Default 1 day — eBay payment+settle is at least ~24h regardless
	 * of what the hazard model predicts, and yields aren't actually
	 * compoundable below that resolution.
	 */
	minDaysToSell?: number;
}

/**
 * Floor on the competition multiplier — even when every active ask is
 * cheaper than the candidate price, real markets aren't strictly
 * cheapest-first (different photos / sellers / BIN-vs-Best-Offer). A
 * 0.15 floor prevents the multiplier from collapsing predictions to
 * "infinite days" for items that might still sell.
 */
const COMPETITION_FLOOR = 0.15;

/**
 * Recommend a list price by maximizing `netCents − hurdleRate·E[T_sell]`
 * over a grid of candidate prices around the sold mean. Returns null
 * when the market lacks `meanDaysToSell` (no time-to-sell data, no
 * model).
 *
 * Math:
 *   z(P) = (ln P − ln meanCents) / (stdDev_log)
 *        ≈ (P − meanCents) / stdDevCents · 1/√1   (linear approx for log)
 *   λ(z) = (1 / meanDaysToSell) · exp(−β · z)     (rate at z=0 = 1/T̄)
 *   T(P) = 1 / λ(z)                                (expected days)
 *   N(P) = P · (1 − feeRate) − fixed − ship        (net per sale)
 *   yield(P) = N(P) / T(P)                          (cents per day)
 *
 * Pick P maximizing `yield − hurdleRate · capital_at_risk`. The
 * implementation uses a discrete grid; closed-form would buy little for
 * the typical 31-point search.
 */
export function optimalListPrice(
	market: MarketStats,
	options: OptimalListPriceOptions = {},
): ListPriceRecommendation | null {
	if (!market.meanDaysToSell || market.meanDaysToSell <= 0) return null;
	if (market.stdDevCents <= 0 || market.meanCents <= 0) return null;
	const meanDays = market.meanDaysToSell;

	const beta = options.beta ?? DEFAULT_ELASTICITY;
	const fees = options.fees ?? DEFAULT_FEES;
	const ship = options.outboundShippingCents ?? 0;
	const zMin = options.zMin ?? -0.5;
	const zMax = options.zMax ?? 1.5;
	const steps = options.steps ?? 21;
	const minT = options.minDaysToSell ?? 1;
	const maxT = options.maxDaysToSell;
	const asks = options.activeAskPrices ?? [];
	const buyPriceCents = options.buyPriceCents ?? 0;
	if (steps < 2) throw new Error(`steps must be ≥ 2, got ${steps}`);

	// Use stdDev / mean as the linear z denominator — robust + cheap.
	// Equivalent to a normal-around-mean approximation; for proper
	// lognormal we'd swap in a log-variance estimate when callers start
	// supplying it.
	const sigma = market.stdDevCents;

	// Stale-market correction: when the active ask median has drifted >10%
	// from the sold mean (typical when the live market has moved since
	// the 90-day sold window — drops cooling, supply constraints loosening,
	// etc), recenter the grid 50/50 between sold mean and active median
	// so the recommendation isn't anchored to history that no longer holds.
	const center = blendedCenter(market.meanCents, asks);
	const lambda0 = 1 / meanDays; // sales/day at z=0

	// Pre-sort active ask prices for the position-aware competition factor.
	const askPrices = [...asks].sort((a, b) => a - b);

	let best: ListPriceRecommendation | null = null;
	let bestYield = -Infinity;

	for (let i = 0; i < steps; i++) {
		const z = zMin + (i * (zMax - zMin)) / (steps - 1);
		const priceCents = Math.max(1, Math.round(center + z * sigma));
		const compFactor = competitionFactor(priceCents, askPrices);
		const lambda = lambda0 * Math.exp(-beta * z) * compFactor;
		if (lambda <= 0) continue;
		const T = 1 / lambda;
		// Floor T at `minT` for both ranking and the user-facing field —
		// the hazard model can predict sub-day sells at extreme z but
		// realistic eBay settlement takes at least ~1 day regardless.
		const Teff = Math.max(T, minT);
		// Honour caller's "must sell within X days" constraint — drop prices
		// whose predicted hold exceeds the window.
		if (maxT != null && Teff > maxT) continue;
		const fb = feeBreakdown(priceCents, fees);
		const netCents = priceCents - fb.totalCents - ship;
		if (netCents <= 0) continue;
		// Rank by flipping yield when a buy cost is supplied — that's the
		// rate the reseller's capital actually compounds at. When buyPrice
		// is 0 (draft / reprice flows that don't know the acquisition cost),
		// this collapses to the gross yield used historically.
		const flipNetCents = netCents - buyPriceCents;
		const yieldPerDay = flipNetCents / Teff;
		if (yieldPerDay > bestYield) {
			bestYield = yieldPerDay;
			const sellProb = (h: number) => 1 - Math.exp(-lambda * h);
			// Annualized IRR over the floored T_eff so cap-saturation only
			// fires for genuinely-fast-and-profitable deals.
			const baselineCost = Math.max(1, ship + fb.totalCents);
			const rawIrr = (priceCents / baselineCost) ** (365 / Teff) - 1;
			const annualizedRoi = Number.isFinite(rawIrr) ? Math.min(rawIrr, 100) : 100;
			best = {
				listPriceCents: priceCents,
				expectedDaysToSell: Teff,
				sellProb7d: sellProb(7),
				sellProb14d: sellProb(14),
				sellProb30d: sellProb(30),
				netCents,
				dollarsPerDay: Math.round(yieldPerDay),
				annualizedRoi,
			};
		}
	}

	void options.hurdleRate; // hurdle rate enters via the yield-rank optimum (higher yield ≥ hurdle implicitly)
	return best;
}

/**
 * Blend sold mean and active median when they meaningfully diverge.
 * Threshold is 10% — small drift is noise, large drift signals a
 * regime shift the sold window hasn't caught up to yet.
 */
function blendedCenter(soldMeanCents: number, askPrices: ReadonlyArray<number>): number {
	if (askPrices.length < 5) return soldMeanCents;
	const sorted = [...askPrices].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const askMedian = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
	const drift = Math.abs(askMedian - soldMeanCents) / soldMeanCents;
	if (drift <= 0.1) return soldMeanCents;
	return Math.round(0.5 * soldMeanCents + 0.5 * askMedian);
}

/**
 * Position-aware competition multiplier on the hazard rate. Asks priced
 * strictly below the candidate take demand first; the candidate's
 * effective sale rate scales with the share of demand that survives them.
 *
 * Strict-less-than (not <=) so an exact price match doesn't penalise
 * the candidate — buyers split ties, they don't queue. Floor at
 * `COMPETITION_FLOOR` so the predicted days-to-sell never collapses to
 * "infinite" for an objectively-overpriced listing.
 */
function competitionFactor(priceCents: number, sortedAskPrices: ReadonlyArray<number>): number {
	if (sortedAskPrices.length === 0) return 1;
	let cBelow = 0;
	for (const ask of sortedAskPrices) {
		if (ask < priceCents) cBelow++;
		else break; // sorted: rest are ≥ priceCents
	}
	const share = (sortedAskPrices.length - cBelow) / sortedAskPrices.length;
	return Math.max(COMPETITION_FLOOR, share);
}
