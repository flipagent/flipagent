/**
 * Pure-function coverage for the credit pricing + lifecycle helpers in
 * `auth/limits.ts`. These don't touch the DB, so they run fast and are
 * the right place to lock in the pricing contract — drift in any of
 * these constants would silently change customer bills.
 */

import { describe, expect, it } from "vitest";
import {
	AUTO_RECHARGE_COOLDOWN_MS,
	AUTO_RECHARGE_MAX_THRESHOLD,
	AUTO_RECHARGE_MIN_THRESHOLD,
	creditsForCall,
	effectiveTier,
	ensureValidCreditAmount,
	PACK_DENOMINATIONS,
	PAST_DUE_GRACE_DAYS,
	PER_CREDIT_USD,
	pricePerCreditUsd,
	TIER_LIMITS,
	topUpPriceCents,
	worstCaseCreditsForEndpoint,
} from "../../src/auth/limits.js";

describe("TIER_LIMITS", () => {
	it("Free is one-time (lifetime grant)", () => {
		expect(TIER_LIMITS.free.oneTime).toBe(true);
		expect(TIER_LIMITS.free.credits).toBe(500);
	});

	it("paid tiers refill monthly", () => {
		expect(TIER_LIMITS.hobby.oneTime).toBe(false);
		expect(TIER_LIMITS.standard.oneTime).toBe(false);
		expect(TIER_LIMITS.growth.oneTime).toBe(false);
	});

	it("burst caps escalate with tier", () => {
		expect(TIER_LIMITS.free.burstPerMin).toBeLessThan(TIER_LIMITS.hobby.burstPerMin);
		expect(TIER_LIMITS.hobby.burstPerMin).toBeLessThan(TIER_LIMITS.standard.burstPerMin);
		expect(TIER_LIMITS.standard.burstPerMin).toBeLessThan(TIER_LIMITS.growth.burstPerMin);
	});
});

describe("creditsForCall — transport-aware pricing", () => {
	it("evaluate is 50 regardless of source", () => {
		expect(creditsForCall({ endpoint: "/v1/evaluate", source: "rest" })).toBe(50);
		expect(creditsForCall({ endpoint: "/v1/evaluate/items/123", source: "scrape" })).toBe(50);
	});

	it("evaluate sub-routes (featured, scopes) charge 0", () => {
		expect(creditsForCall({ endpoint: "/v1/evaluate/featured", source: "rest" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/evaluate/scopes", source: "scrape" })).toBe(0);
	});

	it("items/products/categories/trends — scrape charges 2c, rest charges 1c", () => {
		expect(creditsForCall({ endpoint: "/v1/items/search", source: "scrape" })).toBe(2);
		expect(creditsForCall({ endpoint: "/v1/items/search", source: "rest" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/products/abc", source: "scrape" })).toBe(2);
		expect(creditsForCall({ endpoint: "/v1/categories/tree", source: "rest" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/trends/popular", source: "scrape" })).toBe(2);
	});

	it("items via bridge or trading is 0 (runs in user's browser/passthrough)", () => {
		expect(creditsForCall({ endpoint: "/v1/items/123", source: "bridge" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/items/123", source: "trading" })).toBe(0);
	});

	it("unknown source defaults to 1c on metered paths (conservative)", () => {
		expect(creditsForCall({ endpoint: "/v1/items/123", source: null })).toBe(1);
	});

	it("sell-side / passthrough endpoints always charge 0", () => {
		expect(creditsForCall({ endpoint: "/v1/listings", source: "rest" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/sales/123", source: "trading" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/forwarder/planet/items", source: "rest" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/purchases", source: "bridge" })).toBe(0);
	});
});

describe("worstCaseCreditsForEndpoint — pre-charge gate", () => {
	it("evaluate worst case = 50", () => {
		expect(worstCaseCreditsForEndpoint("/v1/evaluate")).toBe(50);
		expect(worstCaseCreditsForEndpoint("/v1/evaluate/items/123")).toBe(50);
	});

	it("items/products/categories/trends worst case = 2 (scrape)", () => {
		expect(worstCaseCreditsForEndpoint("/v1/items/search")).toBe(2);
		expect(worstCaseCreditsForEndpoint("/v1/products/123")).toBe(2);
		expect(worstCaseCreditsForEndpoint("/v1/categories/tree")).toBe(2);
		expect(worstCaseCreditsForEndpoint("/v1/trends/popular")).toBe(2);
	});

	it("evaluate sub-routes (featured/scopes) are 0", () => {
		expect(worstCaseCreditsForEndpoint("/v1/evaluate/featured")).toBe(0);
		expect(worstCaseCreditsForEndpoint("/v1/evaluate/scopes/curated")).toBe(0);
	});

	it("non-metered endpoints worst case = 0", () => {
		expect(worstCaseCreditsForEndpoint("/v1/listings")).toBe(0);
		expect(worstCaseCreditsForEndpoint("/v1/me")).toBe(0);
		expect(worstCaseCreditsForEndpoint("/v1/health")).toBe(0);
	});
});

describe("effectiveTier — past_due grace expiry", () => {
	const NOW = new Date("2026-05-10T12:00:00Z");

	it("free stays free", () => {
		expect(
			effectiveTier(
				{ tier: "free", subscriptionStatus: null, pastDueSince: null },
				NOW,
			),
		).toBe("free");
	});

	it("paid + active stays at paid tier", () => {
		expect(
			effectiveTier(
				{ tier: "standard", subscriptionStatus: "active", pastDueSince: null },
				NOW,
			),
		).toBe("standard");
	});

	it("paid + past_due within grace stays at paid tier", () => {
		const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
		expect(
			effectiveTier(
				{ tier: "standard", subscriptionStatus: "past_due", pastDueSince: fiveDaysAgo },
				NOW,
			),
		).toBe("standard");
	});

	it("paid + past_due past grace downgrades to free", () => {
		const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
		expect(
			effectiveTier(
				{ tier: "standard", subscriptionStatus: "past_due", pastDueSince: eightDaysAgo },
				NOW,
			),
		).toBe("free");
	});

	it("past_due with null anchor doesn't downgrade (defensive — webhook bug shouldn't kill paid users)", () => {
		expect(
			effectiveTier(
				{ tier: "growth", subscriptionStatus: "past_due", pastDueSince: null },
				NOW,
			),
		).toBe("growth");
	});

	it("PAST_DUE_GRACE_DAYS is exactly 7", () => {
		expect(PAST_DUE_GRACE_DAYS).toBe(7);
	});
});

describe("top-up pricing — tier-aware per-credit", () => {
	it("higher tier has lower per-credit cost (volume discount shape)", () => {
		expect(PER_CREDIT_USD.hobby).toBeGreaterThan(PER_CREDIT_USD.standard);
		expect(PER_CREDIT_USD.standard).toBeGreaterThan(PER_CREDIT_USD.growth);
	});

	it("pricePerCreditUsd throws on free", () => {
		expect(() => pricePerCreditUsd("free")).toThrow(/Free tier has no top-up pricing/);
	});

	it("topUpPriceCents — Hobby 5k = $15.00 (1500c)", () => {
		expect(topUpPriceCents("hobby", 5_000)).toBe(1500);
	});

	it("topUpPriceCents — Standard 25k = $50.00 (5000c)", () => {
		expect(topUpPriceCents("standard", 25_000)).toBe(5000);
	});

	it("topUpPriceCents — Growth 100k = $150.00 (15000c)", () => {
		expect(topUpPriceCents("growth", 100_000)).toBe(15000);
	});

	it("a Hobby 25k pack costs more than a Standard 25k pack (Hobby pays more per credit)", () => {
		expect(topUpPriceCents("hobby", 25_000)).toBeGreaterThan(topUpPriceCents("standard", 25_000));
	});
});

describe("ensureValidCreditAmount — closed denomination set", () => {
	it("accepts every PACK_DENOMINATION", () => {
		for (const d of PACK_DENOMINATIONS) {
			expect(ensureValidCreditAmount(d)).toBe(d);
		}
	});

	it("rejects off-menu amounts", () => {
		expect(() => ensureValidCreditAmount(1_000)).toThrow();
		expect(() => ensureValidCreditAmount(50_000)).toThrow();
		expect(() => ensureValidCreditAmount(99_999)).toThrow();
	});

	it("rejects non-integers", () => {
		expect(() => ensureValidCreditAmount(5_000.5)).toThrow();
	});
});

describe("auto-recharge bounds", () => {
	it("threshold lower bound is 100 (smaller is meaningless — every call would fire)", () => {
		expect(AUTO_RECHARGE_MIN_THRESHOLD).toBe(100);
	});

	it("threshold upper bound is 50k (above this, upgrade tier instead)", () => {
		expect(AUTO_RECHARGE_MAX_THRESHOLD).toBe(50_000);
	});

	it("cooldown is 60s (long enough to avoid double-fire, short enough to feel responsive)", () => {
		expect(AUTO_RECHARGE_COOLDOWN_MS).toBe(60_000);
	});
});
