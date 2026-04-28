/**
 * Sold-price median + percentile estimator. Pure functions over arrays of
 * price observations. Time-decay weighted variant exists for noisy data.
 */

import type { ActiveAsk, AskStats, MarketStats, PriceObservation } from "./types.js";

function cmp(a: number, b: number): number {
	return a - b;
}

/**
 * Compute the unweighted median of a numeric array. Returns null if the
 * input is empty. Uses the conventional definition: average of the two
 * middle values when length is even.
 */
export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort(cmp);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
	}
	return sorted[mid] ?? null;
}

/**
 * Returns the value at the given percentile (0..1) using linear
 * interpolation. Quantile R-7 (numpy default).
 */
export function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	if (p < 0 || p > 1) throw new Error(`percentile must be in [0,1], got ${p}`);
	const sorted = [...values].sort(cmp);
	const idx = p * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo] ?? null;
	const frac = idx - lo;
	return Math.round((sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac);
}

/**
 * Arithmetic mean of a numeric array. Returns null on empty input.
 * For sold-price observations, this is the probability-weighted
 * expectation of sale price under the empirical distribution — i.e.
 * "if I list this and it sells, what do I expect to receive?"
 */
export function mean(values: number[]): number | null {
	if (values.length === 0) return null;
	let sum = 0;
	for (const v of values) sum += v;
	return Math.round(sum / values.length);
}

/**
 * Population standard deviation. Returns null on empty input, 0 on
 * single-element input. Used as the uncertainty (σ) around `mean`.
 */
export function stdDev(values: number[]): number | null {
	if (values.length === 0) return null;
	if (values.length === 1) return 0;
	const m = mean(values) ?? 0;
	let sumSq = 0;
	for (const v of values) sumSq += (v - m) * (v - m);
	return Math.round(Math.sqrt(sumSq / values.length));
}

/**
 * Time-decay weighted median. More recent sales count more — useful when
 * the market is moving quickly. `halfLifeDays` is the time after which a
 * sample's weight halves.
 */
export function decayedMedian(
	observations: PriceObservation[],
	now: Date = new Date(),
	halfLifeDays = 14,
): number | null {
	if (observations.length === 0) return null;
	const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
	const weighted = observations
		.map((o) => {
			const t = o.soldAt ? new Date(o.soldAt).getTime() : now.getTime();
			const ageMs = Math.max(0, now.getTime() - t);
			const weight = 0.5 ** (ageMs / halfLifeMs);
			return { value: o.priceCents, weight };
		})
		.sort((a, b) => a.value - b.value);
	const totalWeight = weighted.reduce((s, x) => s + x.weight, 0);
	if (totalWeight === 0) return null;
	let acc = 0;
	const target = totalWeight / 2;
	for (const w of weighted) {
		acc += w.weight;
		if (acc >= target) return w.value;
	}
	return weighted[weighted.length - 1]?.value ?? null;
}

/**
 * Generic IQR outlier filter — drops items whose key value falls outside
 * `[Q1 − k·IQR, Q3 + k·IQR]`. Default k=1.5 matches Tukey. Used directly
 * by `summarizeSold` to clean PriceObservation[] in one pass.
 */
export function filterIqrOutliersBy<T>(items: readonly T[], key: (item: T) => number, k = 1.5): T[] {
	if (items.length < 4) return [...items];
	const sorted = [...items].map(key).sort(cmp);
	const q1 = percentile(sorted, 0.25) ?? 0;
	const q3 = percentile(sorted, 0.75) ?? 0;
	const iqr = q3 - q1;
	const lo = q1 - k * iqr;
	const hi = q3 + k * iqr;
	return items.filter((item) => {
		const v = key(item);
		return v >= lo && v <= hi;
	});
}

/**
 * Numeric-vector specialization of `filterIqrOutliersBy`. Identity key.
 */
export function filterIqrOutliers(values: number[], k = 1.5): number[] {
	return filterIqrOutliersBy(values, (v) => v, k);
}

/**
 * Tunables for `summarizeSold` / `summarizeAsks` / `summarizeMarket`.
 */
export interface SummarizeOptions {
	/** IQR fence multiplier for outlier filtering. Default 1.5 (Tukey). */
	iqrK?: number;
}

export interface MarketContext {
	keyword: string;
	marketplace: string;
	windowDays: number;
}

/**
 * Drop outliers and compute mean/median/p25/p75/stdDev/salesPerDay over
 * a population of sold observations. Optionally aggregates `durationDays`
 * into `meanDaysToSell` + `daysStdDev` when at least one obs carries it.
 *
 * Intentionally non-parametric — every field is computable from sold-
 * price observations alone, no parametric fits.
 */
export function summarizeSold(
	observations: PriceObservation[],
	context: MarketContext,
	options: SummarizeOptions = {},
): MarketStats {
	const cleanedObs = filterIqrOutliersBy(observations, (o) => o.priceCents, options.iqrK);
	const cleanedPrices = cleanedObs.map((o) => o.priceCents);
	const n = cleanedPrices.length;
	const salesPerDay = context.windowDays > 0 ? n / context.windowDays : 0;

	// Aggregate durationDays when at least one cleaned observation carries it.
	// Sub-day durations are dropped to keep downstream IRR finite.
	const durations: number[] = [];
	for (const o of cleanedObs) {
		if (typeof o.durationDays === "number" && Number.isFinite(o.durationDays) && o.durationDays > 0) {
			durations.push(o.durationDays);
		}
	}
	const meanDaysToSell = durations.length > 0 ? (mean(durations) ?? undefined) : undefined;
	const daysStdDev = durations.length > 0 ? (stdDev(durations) ?? undefined) : undefined;
	const nDurations = durations.length > 0 ? durations.length : undefined;

	return {
		keyword: context.keyword,
		marketplace: context.marketplace,
		windowDays: context.windowDays,
		meanCents: mean(cleanedPrices) ?? 0,
		stdDevCents: stdDev(cleanedPrices) ?? 0,
		medianCents: median(cleanedPrices) ?? 0,
		p25Cents: percentile(cleanedPrices, 0.25) ?? 0,
		p75Cents: percentile(cleanedPrices, 0.75) ?? 0,
		nObservations: n,
		salesPerDay,
		meanDaysToSell,
		daysStdDev,
		nDurations,
		asOf: new Date().toISOString(),
	};
}

/**
 * Drop outliers and compute mean/median/p25/p75/stdDev over a population
 * of currently-active listings (the "ask" side of the book). Returns the
 * stats subset only — no context (keyword/marketplace) since `AskStats`
 * is meant to live nested under a `MarketStats`.
 */
export function summarizeAsks(active: ActiveAsk[], options: SummarizeOptions = {}): AskStats {
	const cleaned = filterIqrOutliersBy(active, (a) => a.priceCents, options.iqrK);
	const prices = cleaned.map((a) => a.priceCents);
	return {
		meanCents: mean(prices) ?? 0,
		stdDevCents: stdDev(prices) ?? 0,
		medianCents: median(prices) ?? 0,
		p25Cents: percentile(prices, 0.25) ?? 0,
		p75Cents: percentile(prices, 0.75) ?? 0,
		nActive: prices.length,
	};
}

/**
 * Convenience composer: take both sold-side comps and active-side asks
 * for the same SKU/marketplace and produce a single `MarketStats` with
 * `asks` populated. Equivalent to:
 *   `{ ...summarizeSold(sold, ctx, opts), asks: summarizeAsks(asks, opts) }`
 * but keeps caller code one line shorter.
 */
export function summarizeMarket(
	inputs: { sold: PriceObservation[]; asks?: ActiveAsk[] },
	context: MarketContext,
	options: SummarizeOptions = {},
): MarketStats {
	const sold = summarizeSold(inputs.sold, context, options);
	if (inputs.asks && inputs.asks.length > 0) {
		sold.asks = summarizeAsks(inputs.asks, options);
	}
	return sold;
}
