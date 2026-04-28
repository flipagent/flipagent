import { describe, expect, it } from "vitest";
import { optimalListPrice, repriceAdvice } from "../../../src/services/quant/lifecycle.js";
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

describe("repriceAdvice", () => {
	const now = new Date("2026-04-25T00:00:00Z");
	const market: MarketStats = { ...baseMarket, meanDaysToSell: 14 };

	it("holds when daysListed is within 1.5× expected", () => {
		const r = repriceAdvice(market, {
			currentPriceCents: 10_000,
			listedAt: new Date("2026-04-15T00:00:00Z"),
			now,
		});
		expect(r.action).toBe("hold");
	});

	it("drops 5% between 1.5× and 2.5× expected", () => {
		const r = repriceAdvice(market, {
			currentPriceCents: 10_000,
			listedAt: new Date("2026-04-01T00:00:00Z"), // 24d listed → 1.71× of 14
			now,
		});
		expect(r.action).toBe("drop");
		expect(r.suggestedPriceCents).toBe(9_500);
	});

	it("drops 10% between 2.5× and 4×", () => {
		const r = repriceAdvice(market, {
			currentPriceCents: 10_000,
			listedAt: new Date("2026-03-15T00:00:00Z"), // 41d → ~2.93×
			now,
		});
		expect(r.action).toBe("drop");
		expect(r.suggestedPriceCents).toBe(9_000);
	});

	it("delists at 4× expected", () => {
		const r = repriceAdvice(market, {
			currentPriceCents: 10_000,
			listedAt: new Date("2026-02-01T00:00:00Z"), // 83d → ~5.93×
			now,
		});
		expect(r.action).toBe("delist");
	});

	it("falls back to hold when meanDaysToSell missing", () => {
		const r = repriceAdvice(baseMarket, {
			currentPriceCents: 10_000,
			listedAt: new Date("2026-02-01T00:00:00Z"),
			now,
		});
		expect(r.action).toBe("hold");
		expect(r.reason).toMatch(/no time-to-sell/);
	});
});
