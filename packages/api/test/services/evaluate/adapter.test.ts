import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { describe, expect, it } from "vitest";
import { isAuthenticityGuaranteed, legitMarketReference } from "../../../src/services/evaluate/adapter.js";

function comp(over: Partial<ItemSummary>): ItemSummary {
	return {
		itemId: `v1|${Math.floor(Math.random() * 1e12)}|0`,
		title: "Comp",
		itemWebUrl: "https://example.com",
		price: { value: "1500.00", currency: "USD" },
		...over,
	} as ItemSummary;
}

describe("isAuthenticityGuaranteed", () => {
	it("true when authenticityGuarantee block present", () => {
		expect(isAuthenticityGuaranteed({ authenticityGuarantee: { description: "x" } })).toBe(true);
	});

	it("true when qualifiedPrograms includes AUTHENTICITY_GUARANTEE", () => {
		expect(isAuthenticityGuaranteed({ qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"] })).toBe(true);
	});

	it("false when neither field is present", () => {
		expect(isAuthenticityGuaranteed({})).toBe(false);
	});

	it("false when qualifiedPrograms has unrelated programs", () => {
		expect(isAuthenticityGuaranteed({ qualifiedPrograms: ["EBAY_REFURBISHED", "EBAY_PLUS"] })).toBe(false);
	});
});

describe("legitMarketReference — AG cohort weighting", () => {
	it("AG comps without seller fields contribute weight=1 (would be excluded otherwise)", () => {
		// Production-shape pool: 4 AG-routed luxury watches whose active
		// SRP cards stripped seller info. Without the AG override, all
		// four would carry weight=0, total trust < 1, and the function
		// would return null — silently suppressing the price-anomaly
		// signal even though we have an underwritten cohort.
		const sold = [
			comp({ price: { value: "1647.00", currency: "USD" }, qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"] }),
			comp({ price: { value: "1700.00", currency: "USD" }, qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"] }),
			comp({ price: { value: "1500.00", currency: "USD" }, qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"] }),
			comp({ price: { value: "1800.00", currency: "USD" }, qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"] }),
		];
		const ref = legitMarketReference(sold);
		expect(ref).not.toBeNull();
		expect(ref!.medianCents).toBeGreaterThan(160_000);
		expect(ref!.medianCents).toBeLessThan(180_000);
	});

	it("non-AG pool with zero seller-trust still returns null (data is truly unverified)", () => {
		// Anonymous-seller pool. AG flag is OFF, sellerTrust returns 0
		// (no fb), totalTrust < 1 → null. AG override should NOT bleed
		// over to non-AG cohorts.
		const sold = [comp({}), comp({}), comp({})];
		expect(legitMarketReference(sold)).toBeNull();
	});

	it("mixed AG + trusted-seller cohort: AG comps add weight on top", () => {
		const sold = [
			// AG-routed, no seller info — was zero-trust before
			comp({ price: { value: "1700.00", currency: "USD" }, qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"] }),
			// Trusted seller, normal listing
			comp({
				price: { value: "1600.00", currency: "USD" },
				seller: { username: "x", feedbackScore: 5_000, feedbackPercentage: "99.5" },
			}),
		];
		const ref = legitMarketReference(sold);
		expect(ref).not.toBeNull();
		// Both contribute — median lands between the two.
		expect(ref!.medianCents).toBeGreaterThanOrEqual(160_000);
		expect(ref!.medianCents).toBeLessThanOrEqual(170_000);
	});
});
