import { describe, expect, it } from "vitest";
import { recommendListPrice } from "../../../src/services/quant/lifecycle.js";
import type { MarketStats } from "../../../src/services/quant/types.js";

const baseMarket: MarketStats = {
	keyword: "x",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 10_000,
	stdDevCents: 1_500,
	medianCents: 10_000,
	p25Cents: 8_500,
	p75Cents: 11_500,
	nObservations: 90,
	salesPerDay: 3,
	asOf: "2026-04-25T00:00:00Z",
};

describe("recommendListPrice", () => {
	it("returns null when the market has no observed flow", () => {
		const dead: MarketStats = { ...baseMarket, salesPerDay: 0 };
		expect(recommendListPrice(dead)).toBeNull();
	});

	it("returns null when median is degenerate", () => {
		const flat: MarketStats = { ...baseMarket, medianCents: 0 };
		expect(recommendListPrice(flat)).toBeNull();
	});

	it("anchors to median × 0.98 with no asks", () => {
		const advice = recommendListPrice(baseMarket);
		expect(advice).not.toBeNull();
		// median 10000 × 0.98 = 9800
		expect(advice!.listPriceCents).toBe(9800);
		expect(advice!.queueAhead).toBe(0);
		expect(advice!.asksAbove).toBe(0);
		// k=1, v=3 → mean=1/3, floored at 0.5
		expect(advice!.expectedDaysToSell).toBe(0.5);
	});

	it("prefers recent14d median when available (no baseline mismatch)", () => {
		// Full window says $100, but recent 14d says $90. Recent should win.
		const m: MarketStats = { ...baseMarket, medianCents: 10_000, recent14dMedianCents: 9_000 };
		const advice = recommendListPrice(m)!;
		// 9000 × 0.98 = 8820
		expect(advice.listPriceCents).toBe(8820);
	});

	it("undercuts the active floor by 2% on inflated asks", () => {
		// sold $100, asks all above ($110-130). Anchor sold, undercut 2%.
		const advice = recommendListPrice(baseMarket, {
			activeAskPrices: [11_000, 11_500, 12_000, 12_500, 13_000],
		})!;
		expect(advice.listPriceCents).toBe(9800);
		// All asks above $9800 → queueAhead 0, asksAbove 5
		expect(advice.queueAhead).toBe(0);
		expect(advice.asksAbove).toBe(5);
	});

	it("blends toward ask median when asks have crashed (drift > 20%)", () => {
		// sold $100, asks all $60-70 (≥ 30% below sold).
		// realAsks: filter to ≥ $50 (50% of $100). All 5 in range.
		// askMed = $65. drift = (100-65)/100 = 35% → cooling blend full strength.
		// blendW = clamp((0.35-0.10)/0.20, 0, 1) = 1.0
		// anchor = 100 × 0.5 + 65 × 0.5 = 82.5 → 83 (cents).
		// list = 83 × 0.98 = 81.34 → 81 cents
		const advice = recommendListPrice(baseMarket, {
			activeAskPrices: [6_000, 6_300, 6_500, 6_700, 7_000],
		})!;
		// Expected listPrice ~ ((10000 + 6500) / 2) × 0.98 = 8085 cents
		expect(advice.listPriceCents).toBeGreaterThan(7_500);
		expect(advice.listPriceCents).toBeLessThan(8_500);
	});

	it("filters out scam outliers (< 50% of soldRef)", () => {
		// soldRef $100, realistic asks $90-110, scams at $10-20.
		// Scams should be ignored from queue.
		const advice = recommendListPrice(baseMarket, {
			activeAskPrices: [1_000, 1_500, 2_000, 9_500, 10_500],
		})!;
		// Asks below 50% of $9800 (= $4900) are dropped: 3 of 5 scams gone.
		// realAsks = [9500, 10500]. Only 2, so blend not triggered (count<3).
		// Anchor = soldRef = 9800. List = 9604.
		expect(advice.queueAhead + advice.asksAbove).toBe(2);
	});

	it("filters out moonshots (> 200% of soldRef)", () => {
		const advice = recommendListPrice(baseMarket, {
			activeAskPrices: [25_000, 30_000, 50_000],
		})!;
		// All asks > 200% of soldRef ($20000). All filtered.
		expect(advice.queueAhead).toBe(0);
		expect(advice.asksAbove).toBe(0);
	});

	it("queue grows time prediction proportionally", () => {
		const v = 2;
		const m: MarketStats = { ...baseMarket, salesPerDay: v };
		const noQueue = recommendListPrice(m, { activeAskPrices: [] })!;
		const withQueue = recommendListPrice(m, {
			activeAskPrices: [9_000, 9_200, 9_400, 9_600, 9_800],
		})!;
		expect(withQueue.queueAhead).toBeGreaterThan(noQueue.queueAhead);
		expect(withQueue.expectedDaysToSell).toBeGreaterThan(noQueue.expectedDaysToSell);
	});

	it("σ band narrows as queue grows (Erlang CV = 1/√k)", () => {
		const m: MarketStats = { ...baseMarket, salesPerDay: 1 };
		const small = recommendListPrice(m)!;
		const large = recommendListPrice(m, {
			activeAskPrices: Array.from({ length: 25 }, (_, i) => 8_000 + i * 50),
		})!;
		// CV = (high - mean) / mean. Larger queue → tighter relative band.
		const smallCV = (small.daysHigh - small.expectedDaysToSell) / small.expectedDaysToSell;
		const largeCV = (large.daysHigh - large.expectedDaysToSell) / large.expectedDaysToSell;
		expect(largeCV).toBeLessThan(smallCV);
	});

	it("subtracts buy price from net (flipping economics)", () => {
		const advice = recommendListPrice(baseMarket, { buyPriceCents: 5_000 })!;
		const noBuy = recommendListPrice(baseMarket)!;
		expect(advice.netCents).toBe(noBuy.netCents - 5_000);
	});
});
