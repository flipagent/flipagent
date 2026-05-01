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
	variations: null,
	selectedVariationId: null,
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

describe("ebayDetailToBrowse — variation id encoding", () => {
	it("emits `v1|<n>|0` when no variation is supplied", () => {
		const out = ebayDetailToBrowse(baseRaw);
		expect(out?.itemId).toBe("v1|406338886641|0");
	});

	it("encodes the variation id into the v1 itemId third segment when supplied", () => {
		const out = ebayDetailToBrowse(baseRaw, "626382683495");
		expect(out?.itemId).toBe("v1|406338886641|626382683495");
	});

	it("falls back to `|0` when the supplied variation id isn't all digits", () => {
		const out = ebayDetailToBrowse(baseRaw, "not-a-number");
		expect(out?.itemId).toBe("v1|406338886641|0");
	});
});

describe("ebayDetailToBrowse — variation aspect + price merging", () => {
	const multiVarRaw: EbayItemDetail = {
		...baseRaw,
		priceCents: 35990,
		aspects: [
			{ name: "Brand", value: "Nike" },
			{ name: "Department", value: "Men" },
		],
		variations: [
			{
				variationId: "626382683495",
				priceCents: 35990,
				currency: "USD",
				aspects: [{ name: "Size", value: "US M8 / W9.5" }],
			},
			{
				variationId: "626578342371",
				priceCents: 13500,
				currency: "USD",
				aspects: [{ name: "Size", value: "PS 3Y / W4.5" }],
			},
		],
		selectedVariationId: "626382683495",
	};

	it("surfaces the variations array as a runtime extension on the detail body", () => {
		const out = ebayDetailToBrowse(multiVarRaw);
		expect((out as Record<string, unknown>).variations).toEqual(multiVarRaw.variations);
		expect((out as Record<string, unknown>).selectedVariationId).toBe("626382683495");
	});

	it("merges the requested variation's aspects into localizedAspects", () => {
		const out = ebayDetailToBrowse(multiVarRaw, "626578342371");
		// Generic aspects flow through; variation aspects (Size: PS 3Y) are added.
		expect(out?.localizedAspects).toEqual([
			{ name: "Brand", value: "Nike", type: "STRING" },
			{ name: "Department", value: "Men", type: "STRING" },
			{ name: "Size", value: "PS 3Y / W4.5", type: "STRING" },
		]);
	});

	it("uses the variation's own price when caller specifies a variation", () => {
		const out = ebayDetailToBrowse(multiVarRaw, "626578342371");
		expect(out?.price).toEqual({ value: "135.00", currency: "USD" });
	});

	it("leaves the page-rendered price untouched when no variation is requested", () => {
		const out = ebayDetailToBrowse(multiVarRaw);
		// matchedVariation only kicks in when caller asked for one — without
		// it the rendered top-of-page price wins.
		expect(out?.price).toEqual({ value: "359.90", currency: "USD" });
		// And the localized aspects stay generic — no variation-tier signal
		// is spliced in unless the caller asked.
		expect(out?.localizedAspects).toEqual([
			{ name: "Brand", value: "Nike", type: "STRING" },
			{ name: "Department", value: "Men", type: "STRING" },
		]);
	});

	it("variation aspect overrides a generic aspect of the same name", () => {
		const raw: EbayItemDetail = {
			...multiVarRaw,
			aspects: [
				{ name: "Brand", value: "Nike" },
				// Generic page-level Size that's wrong for one of the variations.
				{ name: "Size", value: "8" },
			],
		};
		const out = ebayDetailToBrowse(raw, "626578342371");
		const sizes = out?.localizedAspects?.filter((a) => a.name === "Size") ?? [];
		expect(sizes).toHaveLength(1);
		expect(sizes[0]?.value).toBe("PS 3Y / W4.5");
	});
});
