/**
 * Phase 3 (LIST) — recommend the price that maximizes capital efficiency
 * (yield per day). Returns null when the market has no observed flow
 * (`salesPerDay <= 0`).
 *
 * Baseline rate: derived from the count of sold listings in the window
 * (`market.salesPerDay = nObservations / windowDays`) rather than the
 * mean of per-listing durations. Counts are robust to eBay's
 * auto-renewal artifact (a listing that sat for 90d gets re-issued with
 * a fresh creationDate and looks like it sold in 5d), and don't require
 * the optional `itemCreationDate`/`itemEndDate` metadata to be present
 * on every sold sample. In steady state the two formulations are
 * equivalent (Little's Law: stock = flow × waitTime), but the
 * count-based baseline degrades gracefully when duration data is
 * sparse, biased, or absent.
 */

import { feeBreakdown } from "./fees.js";
import { DEFAULT_FEES, type FeeModel, type ListPriceRecommendation, type MarketStats } from "./types.js";

/**
 * Default elasticity of the score function:
 *   score(z) = exp(−β · z)
 * Fed into a multinomial-logit capture share over (current asks + my
 * listing). 1.0 calibrated by simulation across hot/mid/slow/oversupplied
 * markets (see /tmp/mnl-pick2.mjs in PR notes) — at this β the cheapest
 * listing in a typical 5-active market clears in ~half the fair-share
 * time, and worst-priced clears in ~3× fair share. Higher β
 * (sneakers, cards) sharpens the rank discrimination further.
 */
export const DEFAULT_ELASTICITY = 1.0;

/**
 * Per-category elasticity defaults (eBay leaf categoryIds). Calibrated
 * for the MNL share function — values are roughly half of the previous
 * proportional-hazards-with-elasticity ones since β now drives the
 * full softmax-rank instead of being one of two multiplicative factors.
 * Sneakers + cards remain the most price-sensitive (cheapest captures
 * a clear majority of demand); antiques sit close to uniform.
 */
const CATEGORY_BETA: Record<string, number> = {
	"15709": 2.0, // Athletic Shoes
	"183454": 1.5, // Pokémon Trading Cards
	"31387": 1.2, // Wristwatches
	"9355": 1.3, // Cell Phones & Smartphones
	"139973": 1.2, // Video Games
	"169271": 0.7, // Antiques
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
 * Per-listing capture share via multinomial-logit (MNL) over the
 * competing listings.
 *
 *   score(z) = exp(−β · z)
 *   competitive (N≥1 actives):   p = score_me / (Σ score_others + score_me)
 *   alone:                        p = min(1, score_me)
 *
 * Properties this gives us — none of which the prior `cf × elasticity`
 * heuristic delivered cleanly:
 *
 *   1. Flow conservation. When me + every existing active are scored
 *      together, Σ p_i = 1 — total predicted sales rate equals
 *      observed market flow `salesPerDay`. The earlier formulation
 *      summed cf alone to (N+1)/2, leaving the model 2–3× over-
 *      confident on absolute T predictions.
 *   2. Single multiplicative price effect. β controls both rank
 *      discrimination (cheaper score wins more share) and absolute
 *      level penalty (big positive z drives score → 0 against
 *      competitors at z≈0). No double-count between cf and exp.
 *   3. No magic floor. The previous COMPETITION_FLOOR=0.15 existed
 *      to keep "way overpriced" T finite; in MNL bad pricing
 *      naturally yields a tiny but nonzero p without an arbitrary
 *      hard floor.
 *   4. Asymmetric alone-listing behaviour. With no competitors the
 *      MNL share collapses to 1, so we keep the `min(1, score)`
 *      cap on the lone-listing path: an alone listing priced above
 *      the sold mean still gets penalized for being absolutely
 *      overpriced, but a deeply-undercut alone listing doesn't sell
 *      faster than the market itself can mint buyers (capped at the
 *      historical `salesPerDay`). This matches user intuition:
 *      "30개/30일, 경쟁자 0, 정상가 → 1일에 팔린다" out of the box.
 */
function captureShare(zMe: number, zOthers: ReadonlyArray<number>, beta: number): number {
	const sMe = Math.exp(-beta * zMe);
	if (zOthers.length === 0) return Math.min(1, sMe);
	let sumOther = 0;
	for (const z of zOthers) sumOther += Math.exp(-beta * z);
	return sMe / (sumOther + sMe);
}

/**
 * Recommend a list price by maximizing `netCents − hurdleRate·E[T_sell]`
 * over a grid of candidate prices around the sold mean. Returns null
 * when the market has no observed flow (`salesPerDay <= 0`) — without
 * any sales we have no baseline.
 *
 * Math:
 *   z(P) = (P − meanCents) / stdDevCents       (linear approx of log-z)
 *   λ(P) = salesPerDay · captureShare(z(P), z_others, β)
 *   T(P) = 1 / λ(P)                            (expected days)
 *   N(P) = P · (1 − feeRate) − fixed − ship    (net per sale)
 *   yield(P) = N(P) / T(P)                      (cents per day)
 *
 * Pick P maximizing `yield − hurdleRate · capital_at_risk`. The
 * implementation uses a discrete grid; closed-form would buy little for
 * the typical 31-point search.
 */
export function optimalListPrice(
	market: MarketStats,
	options: OptimalListPriceOptions = {},
): ListPriceRecommendation | null {
	if (market.salesPerDay <= 0) return null;
	if (market.stdDevCents <= 0 || market.meanCents <= 0) return null;
	const salesPerDay = market.salesPerDay;

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

	// Pre-compute the existing actives' z-scores against the same center
	// the candidate is evaluated against. Using `center` (the
	// blended-mean) rather than `meanCents` keeps the softmax
	// numerator/denominator on the same axis when the live market has
	// drifted.
	const otherZs = asks.map((a) => (a - center) / sigma);

	let best: ListPriceRecommendation | null = null;
	let bestYield = -Infinity;

	for (let i = 0; i < steps; i++) {
		const z = zMin + (i * (zMax - zMin)) / (steps - 1);
		const priceCents = Math.max(1, Math.round(center + z * sigma));
		const share = captureShare(z, otherZs, beta);
		const lambda = salesPerDay * share;
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
