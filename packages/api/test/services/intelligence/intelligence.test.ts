import type { BrowseSearchResponse, ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { describe, expect, it } from "vitest";
import { draft } from "../../../src/services/draft/draft.js";
import { toCents, toQuantListing } from "../../../src/services/evaluate/adapter.js";
import { discoverDeals } from "../../../src/services/evaluate/discover-deals.js";
import { evaluate } from "../../../src/services/evaluate/evaluate.js";
import { extractSignals } from "../../../src/services/evaluate/signals.js";
import { reprice } from "../../../src/services/reprice/reprice.js";
import { marketSummary } from "../../../src/services/research/summary.js";
import { landedCost } from "../../../src/services/ship/landed-cost.js";

/** Build an ItemSummary with sane defaults for tests. */
function summary(over: Partial<ItemSummary> = {}): ItemSummary {
	return {
		itemId: "v1|123|0",
		title: "Canon EF 50mm f/1.8 STM Lens",
		itemWebUrl: "https://www.ebay.com/itm/123",
		condition: "Used - Excellent",
		price: { value: "60.00", currency: "USD" },
		shippingOptions: [{ shippingCost: { value: "5.00", currency: "USD" } }],
		buyingOptions: ["FIXED_PRICE"],
		seller: { username: "trusted_seller", feedbackScore: 1200, feedbackPercentage: "99.5" },
		thumbnailImages: [
			{ imageUrl: "https://i.ebayimg.com/1.jpg" },
			{ imageUrl: "https://i.ebayimg.com/2.jpg" },
			{ imageUrl: "https://i.ebayimg.com/3.jpg" },
		],
		...over,
	};
}

/** A small, tight market: median ≈ $120. */
const COMPARABLES: ItemSummary[] = [
	summary({ itemId: "c1", price: { value: "115.00", currency: "USD" }, lastSoldDate: "2026-04-10T00:00:00Z" }),
	summary({ itemId: "c2", price: { value: "118.00", currency: "USD" }, lastSoldDate: "2026-04-12T00:00:00Z" }),
	summary({ itemId: "c3", price: { value: "120.00", currency: "USD" }, lastSoldDate: "2026-04-15T00:00:00Z" }),
	summary({ itemId: "c4", price: { value: "122.00", currency: "USD" }, lastSoldDate: "2026-04-18T00:00:00Z" }),
	summary({ itemId: "c5", price: { value: "125.00", currency: "USD" }, lastSoldDate: "2026-04-20T00:00:00Z" }),
];

describe("toCents", () => {
	it("rounds dollar strings to cents", () => {
		expect(toCents("60.00")).toBe(6000);
		expect(toCents("60.499")).toBe(6050);
		expect(toCents("0.01")).toBe(1);
	});

	it("returns 0 for falsy or NaN inputs", () => {
		expect(toCents(undefined)).toBe(0);
		expect(toCents(null)).toBe(0);
		expect(toCents("")).toBe(0);
		expect(toCents("not-a-number")).toBe(0);
	});
});

describe("toQuantListing", () => {
	it("maps ItemSummary fields", () => {
		const l = toQuantListing(summary());
		expect(l.itemId).toBe("v1|123|0");
		expect(l.priceCents).toBe(6000);
		expect(l.shippingCents).toBe(500);
		expect(l.buyingFormat).toBe("FIXED_PRICE");
		expect(l.sellerFeedback).toBe(1200);
		expect(l.sellerFeedbackPercent).toBe(99.5);
		expect(l.imageCount).toBe(3);
		expect(l.descriptionLength).toBeUndefined();
	});

	it("counts ItemDetail images correctly", () => {
		const detail: ItemDetail = {
			itemId: "v1|999|0",
			title: "Canon EF 50mm f/1.8",
			itemWebUrl: "https://www.ebay.com/itm/999",
			price: { value: "60.00", currency: "USD" },
			image: { imageUrl: "https://i.ebayimg.com/main.jpg" },
			additionalImages: [{ imageUrl: "https://i.ebayimg.com/2.jpg" }, { imageUrl: "https://i.ebayimg.com/3.jpg" }],
			description: "A".repeat(200),
		};
		const l = toQuantListing(detail);
		expect(l.imageCount).toBe(3); // image + 2 additional
		expect(l.descriptionLength).toBe(200);
	});
});

describe("evaluate", () => {
	it("flags under-median listing as a buy when confidence threshold is relaxed", () => {
		// ItemSummary lacks `description`, so quant's confidence component for
		// description is floored at 0.1 — pulling overall confidence below the
		// default 0.4 minimum and forcing a "hold" rating despite the margin
		// being there. Real callers either pass an ItemDetail or override the
		// confidence threshold; this test exercises the second path.
		const v = evaluate(summary({ price: { value: "60.00", currency: "USD" } }), {
			comparables: COMPARABLES,
			minConfidence: 0,
			minSalesPerDay: 0, // small fixture market — bypass liquidity floor
			outboundShippingCents: 0, // pin outbound to 0 so margin math is independent of evaluate's $10 default
		});
		expect(v.rating).toBe("buy");
		expect(v.expectedNetCents).toBeGreaterThan(0);
		expect(v.signals.some((s) => s.name === "under_median")).toBe(true);
	});

	it("downgrades to hold when confidence is below threshold", () => {
		// Same ItemSummary but with the default minConfidence of 0.4. Margin
		// still clears; the rating drops to "hold" because we're missing
		// description-length data.
		const v = evaluate(summary({ price: { value: "60.00", currency: "USD" } }), {
			comparables: COMPARABLES,
			minSalesPerDay: 0, // small fixture market — bypass liquidity floor
			outboundShippingCents: 0, // pin outbound to 0 so margin math is independent of evaluate's $10 default
		});
		expect(v.rating).toBe("hold");
		expect(v.expectedNetCents).toBeGreaterThan(0); // margin math still ran
	});

	it("recommends skip when no comparables available", () => {
		const v = evaluate(summary(), {});
		expect(v.rating).toBe("skip");
		expect(v.landedCostCents).toBeNull();
	});

	it("populates landedCostCents when forwarder is set", () => {
		const v = evaluate(summary(), {
			comparables: COMPARABLES,
			forwarder: { destState: "NY", weightG: 500 },
		});
		expect(v.landedCostCents).not.toBeNull();
		// item ($60) + ship ($5) + forwarder leg > 0.
		expect(v.landedCostCents).toBeGreaterThan(6500);
	});

	it("populates bidCeilingCents, winProbability, and netRangeCents when comparables suffice", () => {
		const v = evaluate(summary({ price: { value: "60.00", currency: "USD" } }), {
			comparables: COMPARABLES, // 5 comparables clustered at $115–125
			minConfidence: 0,
			minSalesPerDay: 0,
		});
		// Bid ceiling: invert mean (~$120) ⇒ ceiling > buy price ($65) for trade to clear.
		expect(v.bidCeilingCents).not.toBeNull();
		expect(v.bidCeilingCents!).toBeGreaterThan(6500);
		// Comparables tightly clustered above buy price ⇒ ~all nets positive.
		expect(v.winProbability).not.toBeNull();
		expect(v.winProbability!).toBeGreaterThan(0.5);
		// p10 ≤ p90 with positive band when distribution clears costs.
		expect(v.netRangeCents).not.toBeNull();
		expect(v.netRangeCents!.p10Cents).toBeLessThanOrEqual(v.netRangeCents!.p90Cents);
	});

	it("returns null distribution fields with too few comparables", () => {
		const v = evaluate(summary(), {
			comparables: COMPARABLES.slice(0, 2), // below MIN_COMPARABLES_FOR_DISTRIBUTION
			minConfidence: 0,
			minSalesPerDay: 0,
		});
		expect(v.winProbability).toBeNull();
		expect(v.netRangeCents).toBeNull();
	});

	it("returns null bidCeilingCents when no comparables", () => {
		const v = evaluate(summary(), {});
		expect(v.bidCeilingCents).toBeNull();
		expect(v.winProbability).toBeNull();
		expect(v.netRangeCents).toBeNull();
	});
});

describe("extractSignals", () => {
	it("fires under_median for a heavily discounted listing", () => {
		const hits = extractSignals(summary({ price: { value: "60.00", currency: "USD" } }), COMPARABLES);
		expect(hits.some((h) => h.name === "under_median")).toBe(true);
	});

	it("returns no under_median when comparables array is empty", () => {
		const hits = extractSignals(summary(), []);
		expect(hits.find((h) => h.name === "under_median")).toBeUndefined();
	});
});

describe("landedCost", () => {
	it("returns a breakdown that sums to total", () => {
		const b = landedCost(summary(), { destState: "NY", weightG: 500 });
		expect(b.itemPriceCents + b.shippingCents + b.forwarderCents + b.taxCents).toBe(b.totalCents);
		expect(b.forwarderEtaDays[0]).toBeGreaterThan(0);
		expect(b.forwarderProviderId).toBe("planet-express");
	});
});

describe("find", () => {
	it("filters non-deals and sorts deals by margin × confidence (desc)", async () => {
		const tooExpensive = summary({ itemId: "v1|expensive|0", price: { value: "150.00", currency: "USD" } });
		const cheapDeal = summary({ itemId: "v1|cheap|0", price: { value: "50.00", currency: "USD" } });
		const okDeal = summary({ itemId: "v1|ok|0", price: { value: "70.00", currency: "USD" } });
		const results: BrowseSearchResponse = { itemSummaries: [tooExpensive, okDeal, cheapDeal] };

		const ranked = await discoverDeals(results, { comparables: COMPARABLES, minConfidence: 0, minSalesPerDay: 0 });

		expect(ranked.every((r) => r.evaluation.rating === "buy")).toBe(true);
		expect(ranked.find((r) => r.itemId === "v1|expensive|0")).toBeUndefined();
		// Cheap deal should outrank ok deal (higher margin).
		const cheapIdx = ranked.findIndex((r) => r.itemId === "v1|cheap|0");
		const okIdx = ranked.findIndex((r) => r.itemId === "v1|ok|0");
		if (cheapIdx >= 0 && okIdx >= 0) expect(cheapIdx).toBeLessThan(okIdx);
	});
});

describe("marketSummary", () => {
	it("builds market stats from comparables and returns null listPriceRecommendation without duration", () => {
		const t = marketSummary(COMPARABLES, undefined, { keyword: "canon ef 50mm" });
		expect(t.market.nObservations).toBe(COMPARABLES.length);
		expect(t.market.medianCents).toBeGreaterThan(0);
		expect(t.market.meanDaysToSell).toBeUndefined();
		// optimalListPrice needs meanDaysToSell — null without it.
		expect(t.listPriceRecommendation).toBeNull();
	});

	it("populates asks side when active listings supplied", () => {
		const asks = [summary({ itemId: "a1", price: { value: "130.00", currency: "USD" } })];
		const t = marketSummary(COMPARABLES, asks, {});
		expect(t.market.asks).toBeDefined();
		expect(t.market.asks?.nActive).toBe(1);
	});
});

describe("draft", () => {
	it("returns null listPriceRecommendation with reason when market lacks duration", () => {
		const t = marketSummary(COMPARABLES, undefined, {});
		const d = draft(summary(), t.market);
		expect(d.listPriceRecommendation).toBeNull();
		expect(d.titleSuggestion).toBe("Canon EF 50mm f/1.8 STM Lens");
		expect(d.reason).toMatch(/no time-to-sell data/i);
	});
});

describe("reprice", () => {
	it("recommends hold for a fresh listing without market duration data", () => {
		const t = marketSummary(COMPARABLES, undefined, {});
		const r = reprice(t.market, {
			currentPriceCents: 12000,
			listedAt: new Date().toISOString(),
		});
		expect(r.action).toBe("hold");
		expect(r.daysListed).toBeLessThan(1);
	});

	it("recommends drop when 2× past expected duration with synthetic market", () => {
		const t = marketSummary(COMPARABLES, undefined, {});
		// Inject duration data so the heuristic actually fires.
		const market = { ...t.market, meanDaysToSell: 7 };
		const listedAt = new Date(Date.now() - 21 * 86_400_000).toISOString(); // 21 days ago, 3× expected
		const r = reprice(market, { currentPriceCents: 12000, listedAt });
		expect(r.action).toBe("drop");
		expect(r.suggestedPriceCents).toBeLessThan(12000);
	});
});
