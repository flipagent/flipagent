import { describe, expect, it } from "vitest";
import { computeScore } from "../../../src/services/quant/score.js";
import type { MarketStats, QuantListing } from "../../../src/services/quant/types.js";

const market: MarketStats = {
	keyword: "canon ef 50mm",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 12_500,
	stdDevCents: 2_000,
	medianCents: 12_000,
	p25Cents: 9_000,
	p75Cents: 14_000,
	nObservations: 200,
	salesPerDay: 200 / 30,
	asOf: "2026-04-25T00:00:00Z",
};

const goodQuantListing: QuantListing = {
	itemId: "1",
	title: "Canon EF 50mm f/1.8 STM lens with original box and front rear caps",
	url: "https://www.ebay.com/itm/1",
	priceCents: 6_000,
	currency: "USD",
	sellerFeedback: 1_500,
	sellerFeedbackPercent: 99.2,
	imageCount: 6,
	descriptionLength: 320,
};

describe("computeScore", () => {
	it("rates buy on a high-margin, high-confidence, liquid listing", () => {
		const s = computeScore(goodQuantListing, market);
		expect(s.rating).toBe("buy");
		expect(s.signals.length).toBeGreaterThan(0);
		expect(s.liquid).toBe(true);
	});

	it("rates skip when margin does not clear", () => {
		const tooExpensive = { ...goodQuantListing, priceCents: 11_500 };
		const s = computeScore(tooExpensive, market);
		expect(s.rating).toBe("skip");
		expect(s.reason).toMatch(/below threshold/);
	});

	it("rates hold when margin clears but confidence is low", () => {
		const lowConfidence = { ...goodQuantListing, sellerFeedback: 60, imageCount: 1, descriptionLength: 60 };
		const s = computeScore(lowConfidence, market);
		expect(s.rating).toBe("hold");
	});

	it("rates skip on vetoed listing", () => {
		const newSeller = { ...goodQuantListing, sellerFeedback: 5 };
		const s = computeScore(newSeller, market);
		expect(s.rating).toBe("skip");
		expect(s.confidence).toBe(0);
	});

	it("rates skip when liquidity floor not cleared", () => {
		const illiquid: MarketStats = { ...market, nObservations: 6, salesPerDay: 6 / 30 }; // 0.2/day
		const s = computeScore(goodQuantListing, illiquid);
		expect(s.rating).toBe("skip");
		expect(s.reason).toMatch(/liquidity floor/);
		expect(s.liquid).toBe(false);
	});

	it("emits dollarsPerDay + annualizedRoi when meanDaysToSell present", () => {
		const withDuration: MarketStats = { ...market, meanDaysToSell: 14 };
		const s = computeScore(goodQuantListing, withDuration);
		expect(s.dollarsPerDay).toBeDefined();
		expect(s.dollarsPerDay).toBeGreaterThan(0);
		expect(s.annualizedRoi).toBeDefined();
		expect(s.annualizedRoi!).toBeGreaterThan(0);
	});

	it("leaves time-aware fields undefined when meanDaysToSell missing", () => {
		const s = computeScore(goodQuantListing, market); // no meanDaysToSell
		expect(s.dollarsPerDay).toBeUndefined();
		expect(s.annualizedRoi).toBeUndefined();
	});

	it("annualizedRoi caps at 100 (10000% / yr) for absurdly fast turnover", () => {
		const fast: MarketStats = { ...market, meanDaysToSell: 0.5 }; // half-day cycle
		const s = computeScore(goodQuantListing, fast);
		expect(s.annualizedRoi).toBeLessThanOrEqual(100);
	});

	it("uses mean (not median) as the expected sale anchor", () => {
		// Skewed market — mean above median
		const skewed: MarketStats = { ...market, meanCents: 14_000, medianCents: 12_000 };
		const a = computeScore(goodQuantListing, skewed);
		const flat: MarketStats = { ...market, meanCents: 12_000 };
		const b = computeScore(goodQuantListing, flat);
		// Higher mean → higher expected net (driven by E[sale], not median).
		expect(a.netCents).toBeGreaterThan(b.netCents);
	});
});
