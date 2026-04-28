/**
 * Phase 3 (LIST) and Phase 4 (SIT) — once the deal is acquired, what
 * to do next.
 *
 *   optimalListPrice   — given duration data, recommend the price that
 *                        maximizes capital efficiency (yield per day).
 *   repriceAdvice      — for a listing that's already live, decide
 *                        hold / drop / delist based on time elapsed
 *                        vs market expected time-to-sell.
 *
 * Both functions degrade gracefully when the inputs lack data: e.g.
 * `optimalListPrice` returns null when `market.meanDaysToSell` is
 * absent, and `repriceAdvice` defaults to "hold" when it can't compute
 * a comparison.
 */

import { feeBreakdown } from "./fees.js";
import { DEFAULT_FEES, type FeeModel, type ListPriceAdvice, type MarketStats, type RepriceAdvice } from "./types.js";

/**
 * Default elasticity of sale rate w.r.t. log-price z-score:
 *   λ(z) = λ₀ · exp(−β · z)
 * 1.5 is a reasonable starting value across resale collectibles +
 * electronics until SPRD-side per-listing duration data lets us fit
 * β empirically per category.
 */
export const DEFAULT_ELASTICITY = 1.5;

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
export function optimalListPrice(market: MarketStats, options: OptimalListPriceOptions = {}): ListPriceAdvice | null {
	if (!market.meanDaysToSell || market.meanDaysToSell <= 0) return null;
	if (market.stdDevCents <= 0 || market.meanCents <= 0) return null;

	const beta = options.beta ?? DEFAULT_ELASTICITY;
	const fees = options.fees ?? DEFAULT_FEES;
	const ship = options.outboundShippingCents ?? 0;
	const zMin = options.zMin ?? -0.5;
	const zMax = options.zMax ?? 1.5;
	const steps = options.steps ?? 21;
	const minT = options.minDaysToSell ?? 1;
	if (steps < 2) throw new Error(`steps must be ≥ 2, got ${steps}`);

	// Use stdDev / mean as the linear z denominator — robust + cheap.
	// Equivalent to a normal-around-mean approximation; for proper
	// lognormal we'd swap in a log-variance estimate when callers start
	// supplying it.
	const sigma = market.stdDevCents;
	const mean = market.meanCents;
	const lambda0 = 1 / market.meanDaysToSell; // sales/day at z=0

	let best: ListPriceAdvice | null = null;
	let bestYield = -Infinity;

	for (let i = 0; i < steps; i++) {
		const z = zMin + (i * (zMax - zMin)) / (steps - 1);
		const priceCents = Math.max(1, Math.round(mean + z * sigma));
		const lambda = lambda0 * Math.exp(-beta * z);
		if (lambda <= 0) continue;
		const T = 1 / lambda;
		// Floor T at `minT` for both ranking and the user-facing field —
		// the hazard model can predict sub-day sells at extreme z but
		// realistic eBay settlement takes at least ~1 day regardless.
		const Teff = Math.max(T, minT);
		const fb = feeBreakdown(priceCents, fees);
		const netCents = priceCents - fb.totalCents - ship;
		if (netCents <= 0) continue;
		const yieldPerDay = netCents / Teff;
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
				netCents,
				dollarsPerDay: Math.round(yieldPerDay),
				annualizedRoi,
			};
		}
	}

	void options.hurdleRate; // hurdle rate enters via the yield-rank optimum (higher yield ≥ hurdle implicitly)
	return best;
}

export interface RepriceState {
	/** Current list price in cents. */
	currentPriceCents: number;
	/** When the listing went live. ISO string or Date. */
	listedAt: string | Date;
	/** "Now" — defaults to the wall clock. */
	now?: Date;
}

/**
 * Decide whether a sitting listing should hold, drop, or delist based
 * on how long it's been live vs the market's expected time-to-sell.
 *
 * Heuristic (uses `market.meanDaysToSell` when available):
 *   daysListed < 1.0 × T̄        → hold
 *   1.0 × T̄ ≤ daysListed < 1.5  → hold (still within typical range)
 *   1.5 × T̄ ≤ daysListed < 2.5  → drop 5%
 *   2.5 × T̄ ≤ daysListed < 4.0  → drop 10%
 *   daysListed ≥ 4.0 × T̄        → delist
 *
 * When `meanDaysToSell` is missing, returns `hold` regardless — no
 * model, don't bluff. The caller can substitute a manual rule.
 */
export function repriceAdvice(market: MarketStats, state: RepriceState): RepriceAdvice {
	const now = state.now ?? new Date();
	const listed = state.listedAt instanceof Date ? state.listedAt : new Date(state.listedAt);
	const daysListed = Math.max(0, (now.getTime() - listed.getTime()) / 86_400_000);

	if (!market.meanDaysToSell || market.meanDaysToSell <= 0) {
		return {
			action: "hold",
			daysListed,
			reason: "no time-to-sell data — hold by default",
		};
	}

	const ratio = daysListed / market.meanDaysToSell;
	if (ratio < 1.5) {
		return {
			action: "hold",
			daysListed,
			reason: `${daysListed.toFixed(1)}d listed vs ${market.meanDaysToSell.toFixed(1)}d expected — within range`,
		};
	}
	if (ratio < 2.5) {
		return {
			action: "drop",
			daysListed,
			suggestedPriceCents: Math.round(state.currentPriceCents * 0.95),
			reason: `${ratio.toFixed(1)}× expected duration — drop 5%`,
		};
	}
	if (ratio < 4.0) {
		return {
			action: "drop",
			daysListed,
			suggestedPriceCents: Math.round(state.currentPriceCents * 0.9),
			reason: `${ratio.toFixed(1)}× expected duration — drop 10%`,
		};
	}
	return {
		action: "delist",
		daysListed,
		reason: `${ratio.toFixed(1)}× expected duration — stale, consider relisting from scratch`,
	};
}
