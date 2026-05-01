import { describe, expect, it } from "vitest";
import { optimalListPrice } from "../../../src/services/quant/lifecycle.js";
import type { MarketStats } from "../../../src/services/quant/types.js";

const baseMarket: MarketStats = {
	keyword: "x",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 10_000,
	stdDevCents: 1_500,
	medianCents: 9_800,
	p25Cents: 8_500,
	p75Cents: 11_500,
	nObservations: 90,
	salesPerDay: 3,
	asOf: "2026-04-25T00:00:00Z",
};

describe("optimalListPrice", () => {
	it("returns null when the market has no observed flow", () => {
		const dead: MarketStats = { ...baseMarket, salesPerDay: 0 };
		expect(optimalListPrice(dead)).toBeNull();
	});

	it("returns null when stdDev or mean is degenerate", () => {
		const flat: MarketStats = { ...baseMarket, stdDevCents: 0 };
		expect(optimalListPrice(flat)).toBeNull();
	});

	it("picks an interior point from salesPerDay + stdDev alone", () => {
		// No meanDaysToSell needed — the count-based baseline (salesPerDay)
		// is sufficient on its own.
		const advice = optimalListPrice(baseMarket);
		expect(advice).not.toBeNull();
		expect(advice!.listPriceCents).toBeGreaterThan(0);
		expect(advice!.expectedDaysToSell).toBeGreaterThan(0);
		expect(advice!.netCents).toBeGreaterThan(0);
		expect(advice!.dollarsPerDay).toBeGreaterThan(0);
		expect(advice!.sellProb7d).toBeGreaterThan(0);
		expect(advice!.sellProb7d).toBeLessThan(1);
	});

	it("higher elasticity (beta) compresses the chosen price toward the mean", () => {
		const a = optimalListPrice(baseMarket, { beta: 0.5 })!;
		const b = optimalListPrice(baseMarket, { beta: 3 })!;
		// Above the mean (z>0) larger beta penalizes faster, so the optimum
		// for high-beta walks down the grid relative to low-beta. Below mean
		// the MNL share approaches 1 either way (alone case capped at 1),
		// so the asymmetric shape doesn't flip the inequality.
		expect(a.listPriceCents).toBeGreaterThanOrEqual(b.listPriceCents);
	});

	it("MNL share never predicts faster than the market itself can clear", () => {
		// Conservation regression: under the prior cf×elasticity formulation
		// a deep undercut (z=-2) multiplied λ by exp(3) ≈ 20× the market
		// rate, predicting hours-to-sell against a market that physically
		// cleared 3 buyers/day. The MNL formulation caps share at 1 (alone)
		// or its softmax fraction (competitive), so λ ≤ salesPerDay always.
		const advice = optimalListPrice(baseMarket, { zMin: -2, zMax: 0, steps: 11 })!;
		// salesPerDay=3 → λ ≤ 3 → T ≥ 1/3. Floored at minDaysToSell=1.
		expect(advice.expectedDaysToSell).toBeGreaterThanOrEqual(1);
		expect(advice.sellProb7d).toBeLessThan(1);
	});

	it("MNL conserves flow across a population of competing listings", () => {
		// For a defensible market model the per-listing rates summed across
		// all competitors should equal the observed market flow, not exceed
		// it. Walk the grid for 5 priced listings against the same market
		// and check Σ λ ≤ salesPerDay (with equality when every listing is
		// in the candidate pool — here we evaluate each listing as the
		// "candidate" against the other 4, so we expect ≈ salesPerDay).
		const m: MarketStats = { ...baseMarket, salesPerDay: 1.0 };
		const allAsks = [8500, 9200, 10000, 10500, 11500];
		let totalLambda = 0;
		for (const askPrice of allAsks) {
			const others = allAsks.filter((p) => p !== askPrice);
			const advice = optimalListPrice(m, {
				activeAskPrices: others,
				// Lock the grid to the listing's actual price for this check.
				zMin: (askPrice - m.meanCents) / m.stdDevCents,
				zMax: (askPrice - m.meanCents) / m.stdDevCents,
				steps: 2,
			});
			if (advice) {
				totalLambda += 1 / advice.expectedDaysToSell;
			}
		}
		// MNL guarantees Σ p_i over (5 candidates considered separately
		// against the other 4) ≈ N×(1/N) = 1, so Σ λ ≈ salesPerDay.
		// Exact equality isn't required because the grid floor on T (minT=1)
		// truncates very fast lambdas; check we're in [0.7×, 1.05×] of flow.
		expect(totalLambda).toBeGreaterThan(m.salesPerDay * 0.7);
		expect(totalLambda).toBeLessThanOrEqual(m.salesPerDay * 1.05);
	});

	it("alone listing priced above the sold mean still gets penalized", () => {
		// The min(1, score) clamp on the alone path keeps lone-listing
		// overpricing honest: a +2σ alone listing shouldn't sell at the
		// historical pace just because nobody else is competing.
		const m: MarketStats = { ...baseMarket, salesPerDay: 1.0, stdDevCents: 1500 };
		const fair = optimalListPrice(m, { zMin: 0, zMax: 0, steps: 2 })!;
		const overpriced = optimalListPrice(m, { zMin: 2, zMax: 2, steps: 2 })!;
		// fair-priced alone should be clearly faster than +2σ alone.
		expect(overpriced.expectedDaysToSell).toBeGreaterThan(fair.expectedDaysToSell * 3);
	});
});
