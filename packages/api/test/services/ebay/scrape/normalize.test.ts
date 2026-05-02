import type { EbayItemDetail } from "@flipagent/ebay-scraper";
import { describe, expect, it } from "vitest";
import { ebayDetailToBrowse } from "../../../../src/services/ebay/scrape/normalize.js";

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
	authenticityGuarantee: null,
	shortDescription: null,
	paymentBrands: [],
	shipToLocations: null,
	immediatePay: null,
	guestCheckout: null,
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

describe("ebayDetailToBrowse — top-level aspect promotion (Browse REST parity)", () => {
	it("promotes Color / Size / Pattern from localizedAspects to top-level fields", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			aspects: [
				{ name: "Brand", value: "Jordan" },
				{ name: "Color", value: "Black/Black/Light Graphite" },
				{ name: "Size", value: "US M8" },
				{ name: "Pattern", value: "Colorblock" },
			],
		});
		expect(out?.brand).toBe("Jordan");
		expect(out?.color).toBe("Black/Black/Light Graphite");
		expect(out?.size).toBe("US M8");
		expect(out?.pattern).toBe("Colorblock");
	});

	it("falls back to the matched variation's Size when no top-level Size aspect exists", () => {
		const out = ebayDetailToBrowse(
			{
				...baseRaw,
				aspects: [{ name: "Brand", value: "Jordan" }],
				variations: [
					{
						variationId: "626382683495",
						priceCents: 35990,
						currency: "USD",
						aspects: [{ name: "Size", value: "US M8 / W9.5" }],
					},
				],
				selectedVariationId: "626382683495",
			},
			"626382683495",
		);
		expect(out?.size).toBe("US M8 / W9.5");
	});
});

describe("ebayDetailToBrowse — primaryItemGroup", () => {
	it("emits primaryItemGroup with id/type/title/image when the listing has variations", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			imageUrls: ["https://i.ebayimg.com/g/abc/s-l1600.jpg"],
			variations: [
				{
					variationId: "626382683495",
					priceCents: 35990,
					currency: "USD",
					aspects: [{ name: "Size", value: "US M8" }],
				},
			],
		});
		expect(out?.primaryItemGroup).toEqual({
			itemGroupId: baseRaw.itemId,
			itemGroupType: "SELLER_DEFINED_VARIATIONS",
			itemGroupTitle: baseRaw.title,
			itemGroupImage: { imageUrl: "https://i.ebayimg.com/g/abc/s-l1600.jpg" },
		});
	});

	it("leaves primaryItemGroup undefined on single-SKU listings", () => {
		const out = ebayDetailToBrowse(baseRaw);
		expect(out?.primaryItemGroup).toBeUndefined();
	});
});

describe("ebayDetailToBrowse — returnTerms (formal schema field)", () => {
	it("passes scrape-extracted returnTerms through to the typed field", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			returnTerms: {
				returnsAccepted: true,
				returnPeriod: { value: 30, unit: "DAY" },
				returnShippingCostPayer: "BUYER",
			},
		});
		expect(out?.returnTerms).toEqual({
			returnsAccepted: true,
			returnPeriod: { value: 30, unit: "DAY" },
			returnShippingCostPayer: "BUYER",
		});
	});

	it("leaves returnTerms undefined when scrape couldn't parse the JSON-LD block", () => {
		const out = ebayDetailToBrowse(baseRaw);
		expect(out?.returnTerms).toBeUndefined();
	});
});

describe("ebayDetailToBrowse — wire-shape parity with REST", () => {
	it("buckets payment brands into REST's WALLET / CREDIT_CARD shape", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			paymentBrands: ["PAYPAL", "GOOGLE_PAY", "VISA", "MASTERCARD", "DISCOVER"],
		});
		expect(out?.paymentMethods).toEqual([
			{
				paymentMethodType: "WALLET",
				paymentMethodBrands: [{ paymentMethodBrandType: "PAYPAL" }, { paymentMethodBrandType: "GOOGLE_PAY" }],
			},
			{
				paymentMethodType: "CREDIT_CARD",
				paymentMethodBrands: [
					{ paymentMethodBrandType: "VISA" },
					{ paymentMethodBrandType: "MASTERCARD" },
					{ paymentMethodBrandType: "DISCOVER" },
				],
			},
		]);
	});

	it("leaves paymentMethods undefined when scrape saw no brand icons", () => {
		const out = ebayDetailToBrowse(baseRaw);
		expect(out?.paymentMethods).toBeUndefined();
	});

	it("propagates shortDescription / shipToLocations / immediatePay / enabledForGuestCheckout verbatim", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			shortDescription: "Air Jordan 4 Retro Black Cat",
			shipToLocations: {
				regionIncluded: [{ regionName: "United States" }],
				regionExcluded: [{ regionName: "Ukraine" }],
			},
			immediatePay: true,
			guestCheckout: true,
		});
		expect(out?.shortDescription).toBe("Air Jordan 4 Retro Black Cat");
		expect(out?.shipToLocations).toEqual({
			regionIncluded: [{ regionName: "United States" }],
			regionExcluded: [{ regionName: "Ukraine" }],
		});
		expect(out?.immediatePay).toBe(true);
		expect(out?.enabledForGuestCheckout).toBe(true);
	});

	it("emits topRatedBuyingExperience as an explicit boolean (REST always emits — match the wire)", () => {
		// REST returns `topRatedBuyingExperience: false` even on non-TR listings.
		// Scrape used to emit `undefined` when the badge was absent; now we
		// emit the boolean directly so the wire shapes match.
		expect(ebayDetailToBrowse(baseRaw)?.topRatedBuyingExperience).toBe(false);
		expect(ebayDetailToBrowse({ ...baseRaw, topRatedBuyingExperience: true })?.topRatedBuyingExperience).toBe(true);
	});
});

describe("ebayDetailToBrowse — Authenticity Guarantee", () => {
	it("surfaces qualifiedPrograms + authenticityGuarantee when scrape detected the AG badge", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			authenticityGuarantee: { description: "This item is shipped to an eBay authenticator before delivery." },
		});
		expect(out?.qualifiedPrograms).toEqual(["AUTHENTICITY_GUARANTEE"]);
		expect(out?.authenticityGuarantee).toEqual({
			description: "This item is shipped to an eBay authenticator before delivery.",
		});
	});

	it("leaves AG fields undefined on listings without the badge", () => {
		const out = ebayDetailToBrowse(baseRaw);
		expect(out?.qualifiedPrograms).toBeUndefined();
		expect(out?.authenticityGuarantee).toBeUndefined();
	});
});
