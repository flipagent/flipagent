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
		// elasticity is capped at 1 in both, so the asymmetric shape doesn't
		// flip the inequality.
		expect(a.listPriceCents).toBeGreaterThanOrEqual(b.listPriceCents);
	});

	it("elasticity does not over-reward listing below the sold mean", () => {
		// Pre-cap behaviour: a deep undercut (z=-2) used to multiply lambda
		// by exp(3) ≈ 20×, predicting hours-to-sell in markets that
		// physically cleared 1 buyer/day. With the cap, lambda below mean
		// is bounded by salesPerDay × cf, i.e. the market's own flow.
		const advice = optimalListPrice(baseMarket, { zMin: -2, zMax: 0, steps: 11 })!;
		// salesPerDay=3, cf=1 (no asks supplied) → lambda ≤ 3, so T ≥ 1/3.
		// Floored at minDaysToSell=1, so the visible field is ≥ 1.
		expect(advice.expectedDaysToSell).toBeGreaterThanOrEqual(1);
		// Probability of selling within a week shouldn't be a near-tautology
		// either; for a 3/day market it's high but bounded by the cap.
		expect(advice.sellProb7d).toBeLessThan(1);
	});
});
