import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { describe, expect, it } from "vitest";
import { ebayItemToFlipagent } from "../../../src/services/items/transform.js";

const baseSummary: ItemSummary = {
	itemId: "v1|406338886641|0",
	legacyItemId: "406338886641",
	title: "Apple AirPods Pro 2nd gen",
	itemWebUrl: "https://www.ebay.com/itm/406338886641",
	condition: "New",
	conditionId: "1000",
	price: { value: "189.99", currency: "USD" },
	image: { imageUrl: "https://i.ebayimg.com/images/g/abc/s-l500.jpg" },
};

describe("ebayItemToFlipagent", () => {
	it("converts an active ItemSummary with cents-int Money", () => {
		const out = ebayItemToFlipagent(baseSummary);
		expect(out).toMatchObject({
			id: "406338886641",
			marketplace: "ebay_us",
			status: "active",
			title: "Apple AirPods Pro 2nd gen",
			url: "https://www.ebay.com/itm/406338886641",
			price: { value: 18999, currency: "USD" },
			condition: "New",
			conditionId: "1000",
			images: ["https://i.ebayimg.com/images/g/abc/s-l500.jpg"],
		});
	});

	it("infers status=sold from lastSoldDate and populates soldAt/soldPrice", () => {
		const sold: ItemSummary = {
			...baseSummary,
			lastSoldDate: "2026-04-01T12:00:00Z",
			lastSoldPrice: { value: "175.50", currency: "USD" },
			totalSoldQuantity: 1,
		};
		const out = ebayItemToFlipagent(sold);
		expect(out.status).toBe("sold");
		expect(out.soldAt).toBe("2026-04-01T12:00:00Z");
		expect(out.soldPrice).toEqual({ value: 17550, currency: "USD" });
		expect(out.soldQuantity).toBe(1);
	});

	it("infers status=ended when itemEndDate is in the past", () => {
		const ended: ItemSummary = { ...baseSummary, itemEndDate: "2020-01-01T00:00:00Z" };
		expect(ebayItemToFlipagent(ended).status).toBe("ended");
	});

	it("strips v1| envelope to the bare numeric id when legacyItemId missing", () => {
		const noLegacy: ItemSummary = { ...baseSummary, legacyItemId: undefined };
		expect(ebayItemToFlipagent(noLegacy).id).toBe("406338886641");
	});

	it("dedups images across image / thumbnailImages preserving order", () => {
		const summary: ItemSummary = {
			itemId: "v1|123|0",
			legacyItemId: "123",
			title: "x",
			itemWebUrl: "https://www.ebay.com/itm/123",
			image: { imageUrl: "https://img/a.jpg" },
			thumbnailImages: [{ imageUrl: "https://img/a.jpg" }, { imageUrl: "https://img/b.jpg" }],
			additionalImages: [{ imageUrl: "https://img/c.jpg" }, { imageUrl: "https://img/b.jpg" }],
		};
		expect(ebayItemToFlipagent(summary).images).toEqual([
			"https://img/a.jpg",
			"https://img/b.jpg",
			"https://img/c.jpg",
		]);
	});

	it("converts buyingOptions enum to lowercase", () => {
		const auction: ItemSummary = { ...baseSummary, buyingOptions: ["AUCTION", "BEST_OFFER"] };
		expect(ebayItemToFlipagent(auction).buyingOptions).toEqual(["auction", "best_offer"]);
	});

	it("composes shipping summary — picks cheapest cost and flags free", () => {
		const withShipping: ItemSummary = {
			...baseSummary,
			shippingOptions: [
				{ shippingCost: { value: "9.99", currency: "USD" } },
				{ shippingCost: { value: "0.00", currency: "USD" } },
				{ shippingCostType: "FREE" },
			],
		};
		const out = ebayItemToFlipagent(withShipping);
		expect(out.shipping).toEqual({ cost: { value: 0, currency: "USD" }, free: true });
	});

	it("synthesizes aspects from top-level promotions when localizedAspects missing", () => {
		const detail: ItemDetail = {
			itemId: "v1|456|0",
			legacyItemId: "456",
			title: "Levi's 501",
			itemWebUrl: "https://www.ebay.com/itm/456",
			brand: "Levi's",
			color: "Blue",
			size: "32",
		};
		expect(ebayItemToFlipagent(detail).aspects).toEqual({
			Brand: "Levi's",
			Color: "Blue",
			Size: "32",
		});
	});

	it("prefers localizedAspects over top-level promotions when both exist", () => {
		const detail: ItemDetail = {
			itemId: "v1|789|0",
			legacyItemId: "789",
			title: "x",
			itemWebUrl: "https://www.ebay.com/itm/789",
			brand: "Old Brand",
			localizedAspects: [
				{ name: "Brand", value: "New Brand" },
				{ name: "Material", value: "Cotton" },
			],
		};
		expect(ebayItemToFlipagent(detail).aspects).toEqual({
			Brand: "New Brand",
			Material: "Cotton",
		});
	});

	it("rounds half-up on cents conversion", () => {
		const odd: ItemSummary = { ...baseSummary, price: { value: "12.345", currency: "USD" } };
		expect(ebayItemToFlipagent(odd).price).toEqual({ value: 1235, currency: "USD" });
	});

	it("omits empty location/shipping objects", () => {
		const out = ebayItemToFlipagent(baseSummary);
		expect(out.location).toBeUndefined();
		expect(out.shipping).toBeUndefined();
	});

	// Multi-quantity rolling counts — the user-listing 405993262109 case:
	// 17 stock + 10 already shipped on the same listing. Both numbers must
	// reach the public Item shape so evaluate's `item` carries the live
	// demand signal. Active-listing path (no `lastSoldDate`) is what
	// regression covered: pre-fix, `soldQuantity` was gated on the sold-
	// only branch and dropped silently.
	it("active multi-quantity ItemDetail surfaces estimatedAvailabilities counts", () => {
		const detail = {
			itemId: "v1|405993262109|0",
			legacyItemId: "405993262109",
			title: "Multi-quantity listing",
			itemWebUrl: "https://www.ebay.com/itm/405993262109",
			price: { value: "29.99", currency: "USD" },
			estimatedAvailabilities: [
				{
					estimatedAvailabilityStatus: "IN_STOCK",
					estimatedAvailableQuantity: 17,
					estimatedSoldQuantity: 10,
					estimatedRemainingQuantity: 17,
				},
			],
		} as unknown as ItemDetail;
		const out = ebayItemToFlipagent(detail);
		expect(out.status).toBe("active");
		expect(out.availableQuantity).toBe(17);
		expect(out.soldQuantity).toBe(10);
	});

	it("active ItemSummary surfaces totalSoldQuantity even without lastSoldDate", () => {
		const summary: ItemSummary = { ...baseSummary, totalSoldQuantity: 627 };
		const out = ebayItemToFlipagent(summary);
		expect(out.status).toBe("active");
		expect(out.soldQuantity).toBe(627);
	});

	it("'More than X available' (only sold count populated) leaves availableQuantity absent", () => {
		const detail = {
			itemId: "v1|314208138435|0",
			legacyItemId: "314208138435",
			title: "High-stock listing",
			itemWebUrl: "https://www.ebay.com/itm/314208138435",
			estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK", estimatedSoldQuantity: 1746 }],
		} as unknown as ItemDetail;
		const out = ebayItemToFlipagent(detail);
		expect(out.availableQuantity).toBeUndefined();
		expect(out.soldQuantity).toBe(1746);
	});

	it("totalSoldQuantity (search summary) wins over estimatedSoldQuantity (avoids double-fetch downgrade)", () => {
		// When upstream populated both fields — e.g. a digest stitched
		// from a search response and a refreshed detail — totalSoldQuantity
		// is the authoritative source and shouldn't be overwritten by the
		// detail-side fallback.
		const summary = {
			...baseSummary,
			totalSoldQuantity: 100,
			estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK", estimatedSoldQuantity: 50 }],
		} as unknown as ItemSummary;
		expect(ebayItemToFlipagent(summary).soldQuantity).toBe(100);
	});
});
