/**
 * Pure-function coverage for the credit pricing + lifecycle helpers in
 * `auth/limits.ts`. These don't touch the DB, so they run fast and are
 * the right place to lock in the pricing contract — drift in any of
 * these constants would silently change customer bills.
 */

import { describe, expect, it } from "vitest";
import {
	AUTO_RECHARGE_COOLDOWN_MS,
	creditsForCall,
	DEFAULT_AUTO_RECHARGE_TARGET,
	effectiveTier,
	ensureValidCreditAmount,
	MIN_TOPUP_CREDITS,
	PACK_DENOMINATIONS,
	PAST_DUE_GRACE_DAYS,
	PER_CREDIT_USD,
	pricePerCreditUsd,
	TARGET_RANGE_BY_TIER,
	TIER_LIMITS,
	targetRangeForTier,
	topUpPriceCents,
	worstCaseCreditsForEndpoint,
} from "../../src/auth/limits.js";

describe("TIER_LIMITS", () => {
	it("Free is one-time (lifetime grant)", () => {
		expect(TIER_LIMITS.free.oneTime).toBe(true);
		expect(TIER_LIMITS.free.credits).toBe(1_000);
	});

	it("paid tier sizes match the pricing page (Hobby 3k / Standard 25k / Growth 120k)", () => {
		expect(TIER_LIMITS.hobby.credits).toBe(3_000);
		expect(TIER_LIMITS.standard.credits).toBe(25_000);
		expect(TIER_LIMITS.growth.credits).toBe(120_000);
	});

	it("paid tiers refill monthly", () => {
		expect(TIER_LIMITS.hobby.oneTime).toBe(false);
		expect(TIER_LIMITS.standard.oneTime).toBe(false);
		expect(TIER_LIMITS.growth.oneTime).toBe(false);
	});

	it("burst caps escalate with tier", () => {
		// Strict ordering on both windows. Hobby used to share Free's
		// per-min ceiling — that meant paying for Hobby got you no
		// burst headroom for normal interactive use. Now every tier
		// separates strictly on both dimensions.
		expect(TIER_LIMITS.free.burstPerMin).toBeLessThan(TIER_LIMITS.hobby.burstPerMin);
		expect(TIER_LIMITS.hobby.burstPerMin).toBeLessThan(TIER_LIMITS.standard.burstPerMin);
		expect(TIER_LIMITS.standard.burstPerMin).toBeLessThan(TIER_LIMITS.growth.burstPerMin);
		expect(TIER_LIMITS.free.burstPerHour).toBeLessThan(TIER_LIMITS.hobby.burstPerHour);
		expect(TIER_LIMITS.hobby.burstPerHour).toBeLessThan(TIER_LIMITS.standard.burstPerHour);
		expect(TIER_LIMITS.standard.burstPerHour).toBeLessThan(TIER_LIMITS.growth.burstPerHour);
	});
});

describe("creditsForCall — transport-uniform endpoint pricing", () => {
	it("evaluate is 80 regardless of source", () => {
		expect(creditsForCall({ endpoint: "/v1/evaluate", source: "rest" })).toBe(80);
		expect(creditsForCall({ endpoint: "/v1/evaluate/items/123", source: "scrape" })).toBe(80);
	});

	it("evaluate sub-routes (featured, scopes) charge 0", () => {
		expect(creditsForCall({ endpoint: "/v1/evaluate/featured", source: "rest" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/evaluate/scopes", source: "scrape" })).toBe(0);
	});

	it("items/products/categories/trends — uniform 1 credit per call (transport hidden from user)", () => {
		expect(creditsForCall({ endpoint: "/v1/items/search", source: "scrape" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/items/search", source: "rest" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/products/abc", source: "scrape" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/categories/tree", source: "rest" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/trends/popular", source: "scrape" })).toBe(1);
	});

	it("items via bridge or trading still charges 1 (transport-uniform)", () => {
		// Old model dropped to 0 for bridge/trading (passthrough); new model
		// hides transport from the user — same logical request = same price.
		expect(creditsForCall({ endpoint: "/v1/items/123", source: "bridge" })).toBe(1);
		expect(creditsForCall({ endpoint: "/v1/items/123", source: "trading" })).toBe(1);
	});

	it("unknown source still resolves to 1 on metered paths", () => {
		expect(creditsForCall({ endpoint: "/v1/items/123", source: null })).toBe(1);
	});

	it("agent chat — per-model credit costs (4 supported models)", () => {
		expect(creditsForCall({ endpoint: "/v1/agent/chat", source: null, agentModel: "gpt-5.4-mini" })).toBe(5);
		expect(creditsForCall({ endpoint: "/v1/agent/chat", source: null, agentModel: "gpt-5.5" })).toBe(25);
		expect(creditsForCall({ endpoint: "/v1/agent/chat", source: null, agentModel: "claude-sonnet-4-7" })).toBe(15);
		expect(creditsForCall({ endpoint: "/v1/agent/chat", source: null, agentModel: "gemini-2.5-flash" })).toBe(3);
	});

	it("agent chat — unknown model falls back to mini cost (safe default)", () => {
		expect(creditsForCall({ endpoint: "/v1/agent/chat", source: null, agentModel: null })).toBe(5);
		expect(creditsForCall({ endpoint: "/v1/agent/chat", source: null, agentModel: "gpt-future" })).toBe(5);
	});

	it("sell-side / passthrough endpoints always charge 0", () => {
		expect(creditsForCall({ endpoint: "/v1/listings", source: "rest" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/sales/123", source: "trading" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/forwarder/planet/items", source: "rest" })).toBe(0);
		expect(creditsForCall({ endpoint: "/v1/purchases", source: "bridge" })).toBe(0);
	});
});

describe("worstCaseCreditsForEndpoint — pre-charge gate", () => {
	it("evaluate worst case = 80", () => {
		expect(worstCaseCreditsForEndpoint("/v1/evaluate")).toBe(80);
		expect(worstCaseCreditsForEndpoint("/v1/evaluate/items/123")).toBe(80);
	});

	it("items/products/categories/trends worst case = 1 (transport-uniform)", () => {
		expect(worstCaseCreditsForEndpoint("/v1/items/search")).toBe(1);
		expect(worstCaseCreditsForEndpoint("/v1/products/123")).toBe(1);
		expect(worstCaseCreditsForEndpoint("/v1/categories/tree")).toBe(1);
		expect(worstCaseCreditsForEndpoint("/v1/trends/popular")).toBe(1);
	});

	it("agent/chat worst case = 25 (gpt-5.5 turn — most expensive selectable model)", () => {
		expect(worstCaseCreditsForEndpoint("/v1/agent/chat")).toBe(25);
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
		expect(effectiveTier({ tier: "free", subscriptionStatus: null, pastDueSince: null }, NOW)).toBe("free");
	});

	it("paid + active stays at paid tier", () => {
		expect(effectiveTier({ tier: "standard", subscriptionStatus: "active", pastDueSince: null }, NOW)).toBe(
			"standard",
		);
	});

	it("paid + past_due within grace stays at paid tier", () => {
		const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
		expect(effectiveTier({ tier: "standard", subscriptionStatus: "past_due", pastDueSince: fiveDaysAgo }, NOW)).toBe(
			"standard",
		);
	});

	it("paid + past_due past grace downgrades to free", () => {
		const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
		expect(effectiveTier({ tier: "standard", subscriptionStatus: "past_due", pastDueSince: eightDaysAgo }, NOW)).toBe(
			"free",
		);
	});

	it("past_due with null anchor doesn't downgrade (defensive — webhook bug shouldn't kill paid users)", () => {
		expect(effectiveTier({ tier: "growth", subscriptionStatus: "past_due", pastDueSince: null }, NOW)).toBe("growth");
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

	it("topUpPriceCents — Hobby 1.5k = $14.25 (1425c)", () => {
		expect(topUpPriceCents("hobby", 1_500)).toBe(1425);
	});

	it("topUpPriceCents — Standard 7.5k = $45.00 (4500c)", () => {
		expect(topUpPriceCents("standard", 7_500)).toBe(4500);
	});

	it("topUpPriceCents — Growth 30k = $150.00 (15000c)", () => {
		expect(topUpPriceCents("growth", 30_000)).toBe(15000);
	});

	it("a Hobby 7.5k pack costs more than a Standard 7.5k pack (Hobby pays more per credit)", () => {
		expect(topUpPriceCents("hobby", 7_500)).toBeGreaterThan(topUpPriceCents("standard", 7_500));
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
		expect(() => ensureValidCreditAmount(5_000)).toThrow();
		expect(() => ensureValidCreditAmount(99_999)).toThrow();
	});

	it("rejects non-integers", () => {
		expect(() => ensureValidCreditAmount(1_500.5)).toThrow();
	});
});

describe("auto-recharge bounds", () => {
	it("default target is 1k — uniform across paid tiers", () => {
		expect(DEFAULT_AUTO_RECHARGE_TARGET).toBe(1_000);
	});

	it("min top-up is 100 credits (~$0.50, the Stripe per-charge floor)", () => {
		expect(MIN_TOPUP_CREDITS).toBe(100);
	});

	it("target ranges scale with tier — same min, growing max", () => {
		expect(TARGET_RANGE_BY_TIER.hobby).toEqual({ min: 500, max: 10_000 });
		expect(TARGET_RANGE_BY_TIER.standard).toEqual({ min: 500, max: 50_000 });
		expect(TARGET_RANGE_BY_TIER.growth).toEqual({ min: 500, max: 200_000 });
	});

	it("targetRangeForTier throws on free", () => {
		expect(() => targetRangeForTier("free")).toThrow();
	});

	it("cooldown is 60s (long enough to avoid double-fire, short enough to feel responsive)", () => {
		expect(AUTO_RECHARGE_COOLDOWN_MS).toBe(60_000);
	});
});
