import type { BrowseSearchResponse, ItemSummary } from "@flipagent/types/ebay/buy";
import { describe, expect, it } from "vitest";
import { toQuantListing } from "../../../src/services/evaluate/adapter.js";
import { evaluate } from "../../../src/services/evaluate/evaluate.js";
import { rankCandidates } from "../../../src/services/evaluate/rank-candidates.js";
import { toCents } from "../../../src/services/shared/money.js";
import { landedCost } from "../../../src/services/ship.js";

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

/** A small, tight sold pool: median ≈ $120. */
const SOLD: ItemSummary[] = [
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
	});
});

describe("evaluate", () => {
	it("flags under-median listing as buy", () => {
		const v = evaluate(summary({ price: { value: "60.00", currency: "USD" } }), {
			sold: SOLD,
			outboundShippingCents: 0, // pin outbound to 0 so margin math is independent of evaluate's $10 default
		});
		expect(v.rating).toBe("buy");
		expect(v.expectedNetCents).toBeGreaterThan(0);
	});

	it("recommends skip when no sold listings available", () => {
		const v = evaluate(summary(), {});
		expect(v.rating).toBe("skip");
		expect(v.landedCostCents).toBeNull();
	});

	it("populates landedCostCents when forwarder is set", () => {
		const v = evaluate(summary(), {
			sold: SOLD,
			forwarder: { destState: "NY", weightG: 500 },
		});
		expect(v.landedCostCents).not.toBeNull();
		// item ($60) + ship ($5) + forwarder leg > 0.
		expect(v.landedCostCents).toBeGreaterThan(6500);
	});

	it("populates bidCeilingCents and netRangeCents when sold pool suffices", () => {
		const v = evaluate(summary({ price: { value: "60.00", currency: "USD" } }), {
			sold: SOLD, // 5 sold listings clustered at $115–125
			minNetCents: 0, // pin to break-even so the ceiling math is independent of the $30 default floor
		});
		// Bid ceiling: invert mean (~$120) ⇒ ceiling > buy price ($65) for trade to clear.
		expect(v.bidCeilingCents).not.toBeNull();
		expect(v.bidCeilingCents!).toBeGreaterThan(6500);
		// p10 ≤ p90 with positive band when distribution clears costs.
		expect(v.netRangeCents).not.toBeNull();
		expect(v.netRangeCents!.p10Cents).toBeLessThanOrEqual(v.netRangeCents!.p90Cents);
	});

	it("returns null distribution fields with too few sold listings", () => {
		const v = evaluate(summary(), {
			sold: SOLD.slice(0, 2), // below MIN_SOLD_FOR_DISTRIBUTION
		});
		expect(v.netRangeCents).toBeNull();
	});

	it("returns null bidCeilingCents when no sold listings", () => {
		const v = evaluate(summary(), {});
		expect(v.bidCeilingCents).toBeNull();
		expect(v.netRangeCents).toBeNull();
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
	it("returns every evaluated entry, sorted by dollarsPerDay desc with nullish exits last", async () => {
		const tooExpensive = summary({ itemId: "v1|expensive|0", price: { value: "150.00", currency: "USD" } });
		const cheapDeal = summary({ itemId: "v1|cheap|0", price: { value: "50.00", currency: "USD" } });
		const okDeal = summary({ itemId: "v1|ok|0", price: { value: "70.00", currency: "USD" } });
		const results: BrowseSearchResponse = { itemSummaries: [tooExpensive, okDeal, cheapDeal] };

		const ranked = await rankCandidates(results, { sold: SOLD });

		// Ranker is non-filtering: callers (or UI) decide what counts as a buyable candidate.
		expect(ranked.length).toBe(3);
		// Sort is monotonic non-increasing on dollarsPerDay (nullish to bottom).
		const yields = ranked.map((r) => r.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY);
		for (let i = 1; i < yields.length; i++) {
			expect(yields[i - 1]!).toBeGreaterThanOrEqual(yields[i]!);
		}
	});
});
