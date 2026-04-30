import type { EbayItemDetail } from "@flipagent/ebay-scraper";
import { describe, expect, it } from "vitest";
import { ebayDetailToBrowse } from "../../../src/services/listings/transform.js";

const baseRaw: EbayItemDetail = {
	itemId: "406338886641",
	title: "Test listing",
	url: "https://www.ebay.com/itm/406338886641",
	condition: "New",
	priceCents: 44995,
	currency: "USD",
	shippingCents: null,
	bidCount: null,
	watchCount: null,
	itemCreationDate: null,
	itemEndDate: null,
	listingStatus: "ACTIVE",
	marketplaceListedOn: "EBAY_US",
	itemLocationText: null,
	categoryPath: [],
	categoryIds: [],
	topRatedBuyingExperience: false,
	seller: { name: null, feedbackScore: null, feedbackPercent: null },
	description: null,
	imageUrls: [],
	aspects: [],
	soldOut: null,
	bestOfferEnabled: false,
	returnTerms: null,
	timeLeftText: null,
};

describe("ebayDetailToBrowse — image mapping", () => {
	it("maps the first scraped URL to `image` and the rest to `additionalImages`", () => {
		const raw: EbayItemDetail = {
			...baseRaw,
			imageUrls: [
				"https://i.ebayimg.com/g/abc/s-l1600.jpg",
				"https://i.ebayimg.com/g/abc/s-l1600-2.jpg",
				"https://i.ebayimg.com/g/abc/s-l1600-3.jpg",
			],
		};
		const out = ebayDetailToBrowse(raw);
		expect(out).not.toBeNull();
		expect(out?.image).toEqual({ imageUrl: "https://i.ebayimg.com/g/abc/s-l1600.jpg" });
		expect(out?.additionalImages).toEqual([
			{ imageUrl: "https://i.ebayimg.com/g/abc/s-l1600-2.jpg" },
			{ imageUrl: "https://i.ebayimg.com/g/abc/s-l1600-3.jpg" },
		]);
	});

	it("sets `image` even when there's only one scraped URL (the playground hero reads `image.imageUrl`)", () => {
		const raw: EbayItemDetail = {
			...baseRaw,
			imageUrls: ["https://i.ebayimg.com/g/abc/s-l1600.jpg"],
		};
		const out = ebayDetailToBrowse(raw);
		expect(out?.image).toEqual({ imageUrl: "https://i.ebayimg.com/g/abc/s-l1600.jpg" });
		expect(out?.additionalImages).toBeUndefined();
	});

	it("leaves both image fields undefined when the scraper found no images", () => {
		const out = ebayDetailToBrowse({ ...baseRaw, imageUrls: [] });
		expect(out?.image).toBeUndefined();
		expect(out?.additionalImages).toBeUndefined();
	});
});
