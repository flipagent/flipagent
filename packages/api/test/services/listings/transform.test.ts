import type { ListingCreate, ListingUpdate } from "@flipagent/types";
import type { InventoryItem, OfferDetails } from "@flipagent/types/ebay/sell";
import { describe, expect, it } from "vitest";
import { ebayToListing, listingCreateToEbay, listingUpdateToEbay } from "../../../src/services/listings/transform.js";
import { toCents, toDollarString } from "../../../src/services/shared/money.js";

const baseCreate: ListingCreate = {
	title: "Apple AirPods Pro 2",
	description: "Brand new sealed",
	price: { value: 18999, currency: "USD" },
	quantity: 5,
	condition: "new",
	categoryId: "172465",
	images: ["https://img/a.jpg", "https://img/b.jpg"],
	policies: { fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1" },
	merchantLocationKey: "warehouse-01",
};

describe("listingCreateToEbay", () => {
	it("packs InventoryItem with cents→dollars and uppercase condition", () => {
		const out = listingCreateToEbay(baseCreate, {
			sku: "SKU-1",
			policies: baseCreate.policies!,
			merchantLocationKey: baseCreate.merchantLocationKey!,
		});
		expect(out.inventoryItem.product?.title).toBe("Apple AirPods Pro 2");
		expect(out.inventoryItem.product?.imageUrls).toEqual(["https://img/a.jpg", "https://img/b.jpg"]);
		expect(out.inventoryItem.condition).toBe("NEW");
		expect(out.inventoryItem.availability?.shipToLocationAvailability?.quantity).toBe(5);
	});

	it("packs OfferDetails with dollar-string price + listingPolicies + locationKey", () => {
		const out = listingCreateToEbay(baseCreate, {
			sku: "SKU-1",
			policies: baseCreate.policies!,
			merchantLocationKey: baseCreate.merchantLocationKey!,
		});
		expect(out.offerDetails.sku).toBe("SKU-1");
		expect(out.offerDetails.format).toBe("FIXED_PRICE");
		expect(out.offerDetails.pricingSummary.price).toEqual({ value: "189.99", currency: "USD" });
		expect(out.offerDetails.categoryId).toBe("172465");
		expect(out.offerDetails.listingPolicies).toEqual({
			fulfillmentPolicyId: "F1",
			paymentPolicyId: "P1",
			returnPolicyId: "R1",
		});
		expect(out.offerDetails.merchantLocationKey).toBe("warehouse-01");
		expect(out.offerDetails.marketplaceId).toBe("EBAY_US");
	});

	it("converts auction format", () => {
		const auction: ListingCreate = { ...baseCreate, format: "auction" };
		const out = listingCreateToEbay(auction, {
			sku: "SKU-2",
			policies: auction.policies!,
			merchantLocationKey: auction.merchantLocationKey!,
		});
		expect(out.offerDetails.format).toBe("AUCTION");
	});

	it("preserves quantity default of 1 when omitted", () => {
		const noQty: ListingCreate = { ...baseCreate, quantity: undefined };
		const out = listingCreateToEbay(noQty, {
			sku: "SKU-3",
			policies: noQty.policies!,
			merchantLocationKey: noQty.merchantLocationKey!,
		});
		expect(out.inventoryItem.availability?.shipToLocationAvailability?.quantity).toBe(1);
	});

	it("packs aspects as Record<string, string[]>", () => {
		const withAspects: ListingCreate = {
			...baseCreate,
			aspects: { Brand: ["Apple"], Color: ["White"], "Compatible Model": ["iPhone", "iPad"] },
		};
		const out = listingCreateToEbay(withAspects, {
			sku: "SKU-4",
			policies: withAspects.policies!,
			merchantLocationKey: withAspects.merchantLocationKey!,
		});
		expect(out.inventoryItem.product?.aspects).toEqual({
			Brand: ["Apple"],
			Color: ["White"],
			"Compatible Model": ["iPhone", "iPad"],
		});
	});

	it("packs package weight + dimensions with uppercase eBay units", () => {
		const withPkg: ListingCreate = {
			...baseCreate,
			package: {
				weight: { value: 1.5, unit: "pound" },
				dimensions: { length: 6, width: 4, height: 2, unit: "inch" },
			},
		};
		const out = listingCreateToEbay(withPkg, {
			sku: "SKU-5",
			policies: withPkg.policies!,
			merchantLocationKey: withPkg.merchantLocationKey!,
		});
		expect(out.inventoryItem.packageWeightAndSize?.weight).toEqual({ value: 1.5, unit: "POUND" });
		expect(out.inventoryItem.packageWeightAndSize?.dimensions).toEqual({
			length: 6,
			width: 4,
			height: 2,
			unit: "INCH",
		});
	});
});

describe("listingUpdateToEbay", () => {
	it("only emits inventoryItem payload when item-level fields touched", () => {
		const patch: ListingUpdate = { price: { value: 9999, currency: "USD" } };
		const out = listingUpdateToEbay(patch, { sku: "S", condition: "new", quantity: 1 });
		expect(out.inventoryItem).toBeUndefined();
		expect(out.offer?.pricingSummary?.price).toEqual({ value: "99.99", currency: "USD" });
	});

	it("emits inventoryItem payload when title/aspects/qty/etc touched", () => {
		const patch: ListingUpdate = { title: "New title", quantity: 3 };
		const out = listingUpdateToEbay(patch, { sku: "S", condition: "used_good", quantity: 1 });
		expect(out.inventoryItem?.product?.title).toBe("New title");
		expect(out.inventoryItem?.availability?.shipToLocationAvailability?.quantity).toBe(3);
		expect(out.inventoryItem?.condition).toBe("USED_GOOD");
	});

	it("merges policy update onto offer payload alongside price", () => {
		const patch: ListingUpdate = {
			price: { value: 5000, currency: "USD" },
			policies: { fulfillmentPolicyId: "F2" },
		};
		const out = listingUpdateToEbay(patch, { sku: "S", condition: "new", quantity: 1 });
		expect(out.offer?.pricingSummary?.price).toEqual({ value: "50.00", currency: "USD" });
		expect(out.offer?.listingPolicies).toEqual({ fulfillmentPolicyId: "F2" });
	});
});

describe("ebayToListing (inbound)", () => {
	it("merges inventoryItem + offer + listingId into a flat Listing with cents-int Money", () => {
		const inv: InventoryItem = {
			product: {
				title: "Levi's 501",
				description: "Classic fit",
				imageUrls: ["https://img/x.jpg"],
				aspects: { Brand: ["Levi's"], Size: ["32"] },
			},
			condition: "USED_GOOD",
			availability: { shipToLocationAvailability: { quantity: 2 } },
		};
		const offer: Partial<OfferDetails> & { offerId: string; listing: { listingId: string } } = {
			offerId: "OFR-99",
			sku: "LV-501",
			marketplaceId: "EBAY_US",
			format: "FIXED_PRICE",
			pricingSummary: { price: { value: "45.00", currency: "USD" } },
			categoryId: "11483",
			listingPolicies: { fulfillmentPolicyId: "F", paymentPolicyId: "P", returnPolicyId: "R" },
			merchantLocationKey: "wh-01",
			listing: { listingId: "123456789012" },
		};
		const out = ebayToListing({ sku: "LV-501", inventoryItem: inv, offer });
		expect(out).toMatchObject({
			id: "123456789012",
			sku: "LV-501",
			offerId: "OFR-99",
			marketplace: "ebay",
			status: "active",
			title: "Levi's 501",
			description: "Classic fit",
			price: { value: 4500, currency: "USD" },
			quantity: 2,
			condition: "used_good",
			format: "fixed_price",
			images: ["https://img/x.jpg"],
			aspects: { Brand: ["Levi's"], Size: ["32"] },
			policies: { fulfillmentPolicyId: "F", paymentPolicyId: "P", returnPolicyId: "R" },
			merchantLocationKey: "wh-01",
			url: "https://www.ebay.com/itm/123456789012",
		});
	});

	it("returns status='draft' when offer has no listingId", () => {
		const inv: InventoryItem = {
			condition: "NEW",
			availability: { shipToLocationAvailability: { quantity: 1 } },
			product: { title: "x" },
		};
		const out = ebayToListing({
			sku: "S",
			inventoryItem: inv,
			offer: { offerId: "O" },
		});
		expect(out.status).toBe("draft");
		expect(out.id).toBe("");
	});

	it("returns status='out_of_stock' when active offer has 0 quantity", () => {
		const inv: InventoryItem = {
			condition: "NEW",
			availability: { shipToLocationAvailability: { quantity: 0 } },
			product: { title: "x" },
		};
		const out = ebayToListing({
			sku: "S",
			inventoryItem: inv,
			offer: { offerId: "O", listing: { listingId: "123" } },
		});
		expect(out.status).toBe("out_of_stock");
	});
});

describe("money helpers", () => {
	it("toDollarString rounds to two decimals", () => {
		expect(toDollarString(0)).toBe("0.00");
		expect(toDollarString(1)).toBe("0.01");
		expect(toDollarString(18999)).toBe("189.99");
	});
	it("toCents rounds half-up and handles missing", () => {
		expect(toCents("12.345")).toBe(1235);
		expect(toCents(undefined)).toBe(0);
		expect(toCents("")).toBe(0);
	});
});
