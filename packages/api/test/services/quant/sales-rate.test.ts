import { describe, expect, it } from "vitest";
import { blendSalesPerDay, seedListingRate } from "../../../src/services/quant/sales-rate.js";

describe("seedListingRate", () => {
	const dayMs = 86_400_000;

	it("returns null on missing inputs", () => {
		expect(seedListingRate(null, "2026-04-01")).toBeNull();
		expect(seedListingRate(0, "2026-04-01")).toBeNull();
		expect(seedListingRate(10, null)).toBeNull();
		expect(seedListingRate(10, "garbage")).toBeNull();
	});

	it("returns null when listing is < 1 day old (rate would be unstable)", () => {
		const halfDay = new Date(Date.now() - dayMs / 2).toISOString();
		expect(seedListingRate(5, halfDay)).toBeNull();
	});

	it("computes per-listing rate over the listing's age", () => {
		const tenDaysAgo = new Date(Date.now() - 10 * dayMs).toISOString();
		const rate = seedListingRate(20, tenDaysAgo);
		expect(rate).toBeCloseTo(2, 1); // 20 sold / 10 days
	});

	it("caps the window at 60 days (GTC stale-chain guard)", () => {
		// 200-day-old listing with 10 sold. Without the cap rate would be
		// 0.05/day; with the cap it's 0.167/day — closer to recent reality
		// for a listing whose "X sold" badge tracks rolling cycles.
		const longAgo = new Date(Date.now() - 200 * dayMs).toISOString();
		const rate = seedListingRate(10, longAgo);
		expect(rate).toBeCloseTo(10 / 60, 2);
	});
});

describe("blendSalesPerDay", () => {
	it("is a no-op when seedRate is null", () => {
		expect(blendSalesPerDay(0.5, null)).toBe(0.5);
	});

	it("returns the market rate when seedRate is at-or-below it (no downward push)", () => {
		// A slow seed shouldn't drag the forecast down — we'll relist under
		// our own listing, not the seller's slow one.
		expect(blendSalesPerDay(1.0, 0.5)).toBe(1.0);
		expect(blendSalesPerDay(1.0, 1.0)).toBe(1.0);
	});

	it("geometric-means up when seedRate exceeds market rate", () => {
		// market 0.5/day, seed 8/day → sqrt(4) = 2/day. The seed evidence
		// raises the forecast 4× (vs comp pool) but not 16× (taking seed
		// at face value). Square-root dampening reflects "evidence, not
		// certainty" — we'll be a different seller.
		expect(blendSalesPerDay(0.5, 8)).toBeCloseTo(2, 5);
		// market 1/day, seed 4/day → sqrt(4) = 2/day.
		expect(blendSalesPerDay(1, 4)).toBeCloseTo(2, 5);
	});

	it("returns seedRate verbatim when market rate is zero (no comp pool to mix with)", () => {
		// Niche / freshly-discovered SKUs often have 0 comps in the window.
		// Geometric mean would collapse to zero, wasting the only signal
		// we have — fall back to the seed rate directly.
		expect(blendSalesPerDay(0, 1.5)).toBe(1.5);
	});
});
