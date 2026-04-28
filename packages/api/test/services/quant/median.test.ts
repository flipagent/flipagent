import { describe, expect, it } from "vitest";
import {
	decayedMedian,
	filterIqrOutliers,
	mean,
	median,
	percentile,
	stdDev,
	summarizeAsks,
	summarizeMarket,
	summarizeSold,
} from "../../../src/services/quant/median.js";

describe("median", () => {
	it("returns null on empty input", () => {
		expect(median([])).toBeNull();
	});

	it("computes odd-length median", () => {
		expect(median([100, 200, 300])).toBe(200);
	});

	it("averages two middles for even length", () => {
		expect(median([100, 200, 300, 400])).toBe(250);
	});

	it("does not mutate input", () => {
		const input = [3, 1, 2];
		median(input);
		expect(input).toEqual([3, 1, 2]);
	});
});

describe("percentile", () => {
	it("returns p25 / p75 for evenly spaced inputs", () => {
		const data = [10, 20, 30, 40, 50];
		expect(percentile(data, 0.25)).toBe(20);
		expect(percentile(data, 0.5)).toBe(30);
		expect(percentile(data, 0.75)).toBe(40);
	});

	it("interpolates between samples", () => {
		expect(percentile([0, 100], 0.5)).toBe(50);
	});

	it("rejects out-of-range p", () => {
		expect(() => percentile([1, 2, 3], 1.1)).toThrow();
	});
});

describe("filterIqrOutliers", () => {
	it("drops far-flung values", () => {
		const data = [10, 11, 12, 13, 14, 15, 1000];
		const cleaned = filterIqrOutliers(data);
		expect(cleaned).not.toContain(1000);
	});
});

describe("decayedMedian", () => {
	it("weights recent observations more heavily", () => {
		const now = new Date("2026-01-15T00:00:00Z");
		const recent = { priceCents: 5000, soldAt: "2026-01-14T00:00:00Z" };
		const older = { priceCents: 9000, soldAt: "2025-10-01T00:00:00Z" };
		const result = decayedMedian([recent, older, recent, recent], now, 14);
		expect(result).toBe(5000);
	});
});

describe("mean", () => {
	it("returns null on empty input", () => {
		expect(mean([])).toBeNull();
	});
	it("computes arithmetic mean", () => {
		expect(mean([100, 200, 300])).toBe(200);
	});
});

describe("stdDev", () => {
	it("returns null on empty, 0 on single", () => {
		expect(stdDev([])).toBeNull();
		expect(stdDev([100])).toBe(0);
	});
	it("matches population std-dev", () => {
		// values [100, 200, 300] → mean 200, var = (10000+0+10000)/3 = 6666.67, σ ≈ 81.65
		expect(stdDev([100, 200, 300])).toBe(82);
	});
});

describe("summarizeSold", () => {
	it("returns MarketStats with mean, stdDev, salesPerDay populated", () => {
		const observations = Array.from({ length: 10 }, (_, i) => ({ priceCents: 1000 + i * 100 }));
		observations.push({ priceCents: 1_000_000 });
		const stats = summarizeSold(observations, {
			keyword: "test",
			marketplace: "EBAY_US",
			windowDays: 30,
		});
		expect(stats.medianCents).toBeLessThan(2000);
		expect(stats.meanCents).toBeLessThan(2000);
		expect(stats.stdDevCents).toBeGreaterThan(0);
		expect(stats.nObservations).toBeLessThan(observations.length);
		expect(stats.salesPerDay).toBeCloseTo(stats.nObservations / 30, 6);
	});

	it("salesPerDay = 0 when window is zero", () => {
		const stats = summarizeSold([{ priceCents: 1000 }], {
			keyword: "test",
			marketplace: "EBAY_US",
			windowDays: 0,
		});
		expect(stats.salesPerDay).toBe(0);
	});

	it("aggregates durationDays into mean/std/n when present", () => {
		const observations = [
			{ priceCents: 8000, durationDays: 10 },
			{ priceCents: 8500, durationDays: 20 },
			{ priceCents: 9000, durationDays: 30 },
			{ priceCents: 9500 }, // no duration — excluded from time stats
		];
		const stats = summarizeSold(observations, {
			keyword: "x",
			marketplace: "EBAY_US",
			windowDays: 30,
		});
		expect(stats.nDurations).toBe(3);
		expect(stats.meanDaysToSell).toBe(20);
		expect(stats.daysStdDev).toBeGreaterThan(0);
	});

	it("leaves time fields undefined when no observation has duration", () => {
		const stats = summarizeSold([{ priceCents: 1000 }], {
			keyword: "x",
			marketplace: "EBAY_US",
			windowDays: 30,
		});
		expect(stats.meanDaysToSell).toBeUndefined();
		expect(stats.daysStdDev).toBeUndefined();
		expect(stats.nDurations).toBeUndefined();
	});
});

describe("summarizeAsks", () => {
	it("returns AskStats with mean/median/p25/p75 + nActive", () => {
		const asks = Array.from({ length: 10 }, (_, i) => ({ priceCents: 9000 + i * 100 }));
		const stats = summarizeAsks(asks);
		expect(stats.nActive).toBe(10);
		expect(stats.medianCents).toBeGreaterThan(stats.p25Cents);
		expect(stats.p75Cents).toBeGreaterThan(stats.medianCents);
	});

	it("filters extreme outliers via IQR", () => {
		const asks = Array.from({ length: 10 }, (_, i) => ({ priceCents: 9000 + i * 100 }));
		asks.push({ priceCents: 1_000_000 });
		const stats = summarizeAsks(asks);
		expect(stats.nActive).toBeLessThan(asks.length);
		expect(stats.medianCents).toBeLessThan(20_000);
	});
});

describe("summarizeMarket", () => {
	it("composes sold + asks into a single MarketStats", () => {
		const sold = Array.from({ length: 20 }, (_, i) => ({ priceCents: 8500 + i * 50 }));
		const asks = Array.from({ length: 10 }, (_, i) => ({ priceCents: 10_000 + i * 100 }));
		const market = summarizeMarket({ sold, asks }, { keyword: "x", marketplace: "EBAY_US", windowDays: 30 });
		expect(market.nObservations).toBe(20);
		expect(market.asks).toBeDefined();
		expect(market.asks?.nActive).toBe(10);
		expect(market.asks!.medianCents).toBeGreaterThan(market.medianCents);
	});

	it("leaves asks undefined when no asks input", () => {
		const sold = [{ priceCents: 1000 }];
		const market = summarizeMarket({ sold }, { keyword: "x", marketplace: "EBAY_US", windowDays: 30 });
		expect(market.asks).toBeUndefined();
	});
});
