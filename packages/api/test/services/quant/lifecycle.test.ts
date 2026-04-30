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
	it("returns null when meanDaysToSell is missing", () => {
		expect(optimalListPrice(baseMarket)).toBeNull();
	});

	it("returns null when stdDev or mean is degenerate", () => {
		const flat: MarketStats = { ...baseMarket, stdDevCents: 0, meanDaysToSell: 14 };
		expect(optimalListPrice(flat)).toBeNull();
	});

	it("picks an interior point given meanDaysToSell + stdDev", () => {
		const m: MarketStats = { ...baseMarket, meanDaysToSell: 14 };
		const advice = optimalListPrice(m);
		expect(advice).not.toBeNull();
		expect(advice!.listPriceCents).toBeGreaterThan(0);
		expect(advice!.expectedDaysToSell).toBeGreaterThan(0);
		expect(advice!.netCents).toBeGreaterThan(0);
		expect(advice!.dollarsPerDay).toBeGreaterThan(0);
		expect(advice!.sellProb7d).toBeGreaterThan(0);
		expect(advice!.sellProb7d).toBeLessThan(1);
	});

	it("higher elasticity (beta) compresses the chosen price toward the mean", () => {
		const m: MarketStats = { ...baseMarket, meanDaysToSell: 14 };
		const a = optimalListPrice(m, { beta: 0.5 })!;
		const b = optimalListPrice(m, { beta: 3 })!;
		// When beta is large, listing higher costs you a lot of time → optimum
		// price moves down; when beta is small, the optimum walks up.
		expect(a.listPriceCents).toBeGreaterThanOrEqual(b.listPriceCents);
	});
});
