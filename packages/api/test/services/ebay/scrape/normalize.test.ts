import type { EbayItemDetail } from "@flipagent/ebay-scraper";
import type { ItemDetail } from "@flipagent/types/ebay/buy";
import { describe, expect, it } from "vitest";
import { ebayDetailToBrowse, reconcileBuyingOptions } from "../../../../src/services/ebay/scrape/normalize.js";

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
	epid: null,
	mpn: null,
	lotSize: null,
	conditionDescription: null,
	conditionDescriptors: null,
	marketingPrice: null,
	primaryItemGroup: null,
	availableQuantity: null,
	availabilityThreshold: null,
	soldQuantity: null,
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

describe("ebayDetailToBrowse — buyingOptions auction signal", () => {
	it("emits FIXED_PRICE on a quiet BIN listing (no bids, no countdown)", () => {
		const out = ebayDetailToBrowse(baseRaw);
		expect(out?.buyingOptions).toEqual(["FIXED_PRICE"]);
	});

	it("upgrades to AUCTION when bidCount > 0 even if timeLeftText is missing", () => {
		// Real-world failure mode: PDP rendered without the time-left
		// counter (vendor lazy-render or page variant) but bidcount line
		// shows "22 bids". Pre-fix this fell through to FIXED_PRICE.
		const out = ebayDetailToBrowse({ ...baseRaw, bidCount: 22, timeLeftText: null });
		expect(out?.buyingOptions).toEqual(["AUCTION"]);
	});

	it("emits AUCTION when bidCount is explicitly 0 (scraper parsed '0 bids' on auction PDP)", () => {
		// `.x-bid-count` only renders on auction PDPs, so an explicit numeric
		// 0 means scraper found the auction's bidcount widget reading "0
		// bids" — this is a freshly-listed zero-bid auction, not a BIN.
		// Distinguish from `bidCount: null` (selector missed entirely).
		const out = ebayDetailToBrowse({ ...baseRaw, bidCount: 0, timeLeftText: null });
		expect(out?.buyingOptions).toEqual(["AUCTION"]);
	});

	it("emits AUCTION when timeLeftText is present (zero-bid auction just listed)", () => {
		const out = ebayDetailToBrowse({ ...baseRaw, bidCount: 0, timeLeftText: "6d 14h" });
		expect(out?.buyingOptions).toEqual(["AUCTION"]);
	});

	it("does NOT treat a future itemEndDate as an auction signal — BIN listings carry one too", () => {
		// Real-world failure mode: a 30-day BIN with Best Offer (e.g. a
		// vintage-watch parts-only listing or Authenticity-Guarantee sneaker
		// drop) was getting mis-tagged as ["AUCTION","BEST_OFFER"] when the
		// fix earlier tried `itemEndDate in future` as an auction fallback.
		// itemEndDate isn't auction-specific (BIN durations 7/30 days, GTC).
		const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
		const out = ebayDetailToBrowse({ ...baseRaw, itemEndDate: future, bidCount: null });
		expect(out?.buyingOptions).toEqual(["FIXED_PRICE"]);
	});

	it("BIN with Best Offer + future itemEndDate stays FIXED_PRICE + BEST_OFFER (regression: 30-day BIN)", () => {
		const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
		const out = ebayDetailToBrowse({
			...baseRaw,
			itemEndDate: future,
			bidCount: null,
			bestOfferEnabled: true,
		});
		expect(out?.buyingOptions).toEqual(["FIXED_PRICE", "BEST_OFFER"]);
	});

	it("stacks BEST_OFFER on top of FIXED_PRICE when bestOfferEnabled and no auction signal", () => {
		const out = ebayDetailToBrowse({ ...baseRaw, bestOfferEnabled: true });
		expect(out?.buyingOptions).toEqual(["FIXED_PRICE", "BEST_OFFER"]);
	});

	it("returns undefined when the listing is ENDED (sold-comp lookup)", () => {
		const out = ebayDetailToBrowse({ ...baseRaw, listingStatus: "ENDED", bidCount: 22 });
		expect(out?.buyingOptions).toBeUndefined();
	});
});

describe("reconcileBuyingOptions — REST passthrough fix", () => {
	const liveBidDetail: ItemDetail = {
		itemId: "v1|298265848524|0",
		legacyItemId: "298265848524",
		title: "iPhone 16e (live auction)",
		itemWebUrl: "https://www.ebay.com/itm/298265848524",
		bidCount: 22,
		buyingOptions: ["FIXED_PRICE"],
		estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK" }],
	};

	it("promotes [FIXED_PRICE] to [AUCTION] when bidCount > 0 on a live listing", () => {
		const out = reconcileBuyingOptions(liveBidDetail);
		expect(out.buyingOptions).toEqual(["AUCTION"]);
	});

	it("is a no-op when AUCTION is already in buyingOptions", () => {
		const detail: ItemDetail = { ...liveBidDetail, buyingOptions: ["AUCTION"] };
		expect(reconcileBuyingOptions(detail)).toBe(detail);
	});

	it("is a no-op when there are no bids", () => {
		const detail: ItemDetail = { ...liveBidDetail, bidCount: 0 };
		expect(reconcileBuyingOptions(detail)).toBe(detail);
	});

	it("preserves upstream buyingOptions on ENDED listings even if bidCount > 0 (sold comps)", () => {
		const detail: ItemDetail = {
			...liveBidDetail,
			estimatedAvailabilities: [{ estimatedAvailabilityStatus: "OUT_OF_STOCK" }],
		};
		expect(reconcileBuyingOptions(detail).buyingOptions).toEqual(["FIXED_PRICE"]);
	});
});

describe("ebayDetailToBrowse — estimatedAvailabilities synthesis", () => {
	it("populates available + sold counts on a multi-quantity ACTIVE listing", () => {
		// The user's real listing 405993262109 — 17 available, 10 sold. Both
		// numbers must reach `estimatedAvailabilities[0]` so evaluate's
		// `item` carries the live demand signal end-to-end.
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ACTIVE",
			availableQuantity: 17,
			soldQuantity: 10,
		});
		expect(out?.estimatedAvailabilities).toEqual([
			{
				estimatedAvailabilityStatus: "IN_STOCK",
				estimatedAvailableQuantity: 17,
				estimatedRemainingQuantity: 17,
				estimatedSoldQuantity: 10,
			},
		]);
	});

	it("emits IN_STOCK even at availableQuantity=1 (REST never emits LIMITED_STOCK in practice)", () => {
		// Verified against live REST 2026-05: 135 sampled listings, zero
		// LIMITED_STOCK responses, even at qty=1. Don't synthesise an enum
		// REST itself doesn't emit — keeps parity exact.
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ACTIVE",
			availableQuantity: 1,
			soldQuantity: 2,
		});
		expect(out?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus).toBe("IN_STOCK");
		expect(out?.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity).toBe(1);
	});

	it("'More than 10 available' maps to availabilityThreshold + threshold type (REST parity)", () => {
		// REST's response on these listings: drop estimatedAvailableQuantity,
		// emit `availabilityThreshold: 10, availabilityThresholdType: "MORE_THAN"`.
		// Mirror that exact shape so consumers see the same structure regardless
		// of transport.
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ACTIVE",
			availableQuantity: null,
			availabilityThreshold: 10,
			soldQuantity: 1746,
		});
		const entry = out?.estimatedAvailabilities?.[0];
		expect(entry?.estimatedAvailabilityStatus).toBe("IN_STOCK");
		expect(entry?.estimatedAvailableQuantity).toBeUndefined();
		expect(entry?.availabilityThreshold).toBe(10);
		expect(entry?.availabilityThresholdType).toBe("MORE_THAN");
		expect(entry?.estimatedSoldQuantity).toBe(1746);
	});

	it("emits OUT_OF_STOCK when availableQuantity is 0 (the 'Out of Stock' badge)", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ACTIVE",
			availableQuantity: 0,
			soldQuantity: 40,
		});
		expect(out?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus).toBe("OUT_OF_STOCK");
		expect(out?.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity).toBe(0);
		expect(out?.estimatedAvailabilities?.[0]?.estimatedSoldQuantity).toBe(40);
	});

	it("drops the available-quantity field when only sold count is known ('627 sold')", () => {
		// Listings where eBay hides the count or shows only "X sold" — the
		// availability number stays absent (null on raw → omitted on
		// browse), matching REST behaviour for the same shape.
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ACTIVE",
			availableQuantity: null,
			soldQuantity: 627,
		});
		expect(out?.estimatedAvailabilities).toEqual([
			{ estimatedAvailabilityStatus: "IN_STOCK", estimatedSoldQuantity: 627 },
		]);
	});

	it("emits status-only IN_STOCK when neither count is known (auctions, no badge)", () => {
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ACTIVE",
			availableQuantity: null,
			soldQuantity: null,
		});
		expect(out?.estimatedAvailabilities).toEqual([{ estimatedAvailabilityStatus: "IN_STOCK" }]);
	});

	it("ENDED listing carries scraped soldQuantity into the OUT_OF_STOCK envelope", () => {
		// Sold comps go through this path: when scrape captured a real
		// rolling sold count, surface it on the envelope.
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ENDED",
			soldOut: true,
			soldQuantity: 27,
		});
		expect(out?.estimatedAvailabilities?.[0]).toEqual({
			estimatedAvailabilityStatus: "OUT_OF_STOCK",
			estimatedAvailableQuantity: 0,
			estimatedSoldQuantity: 27,
			estimatedRemainingQuantity: 0,
		});
	});

	it("ENDED listing without scraped soldQuantity leaves estimatedSoldQuantity unset (no fabrication)", () => {
		// Pre-fix this path emitted `estimatedSoldQuantity: 1` whenever
		// `soldOut === true` even when no count was scraped — fabricating a
		// number eBay doesn't actually expose. Now we omit the field so
		// consumers can detect "unknown" via field presence, matching REST
		// behaviour on listings with no count badge.
		const out = ebayDetailToBrowse({
			...baseRaw,
			listingStatus: "ENDED",
			soldOut: true,
			soldQuantity: null,
		});
		expect(out?.estimatedAvailabilities?.[0]).toEqual({
			estimatedAvailabilityStatus: "OUT_OF_STOCK",
			estimatedAvailableQuantity: 0,
			estimatedRemainingQuantity: 0,
		});
		expect(out?.estimatedAvailabilities?.[0]?.estimatedSoldQuantity).toBeUndefined();
	});

	it("emits deliveryOptions ['SHIP_TO_HOME'] when scrape captured a shipping cost (REST parity)", () => {
		// Verified against live REST 2026-05: every shippable listing
		// REST returns carries `deliveryOptions: ["SHIP_TO_HOME"]`. Mirror
		// 1:1 from the same `shippingCents != null` signal scrape already
		// produces.
		const out = ebayDetailToBrowse({ ...baseRaw, shippingCents: 599 });
		expect(out?.estimatedAvailabilities?.[0]?.deliveryOptions).toEqual(["SHIP_TO_HOME"]);
	});

	it("omits deliveryOptions on local-pickup-only listings (no shipping signal)", () => {
		// REST also omits the field on these — scrape mirrors that. Without
		// shippingCents the listing is either pickup-only or eBay didn't
		// surface a carrier service; in both cases the right answer is
		// "no deliveryOptions field."
		const out = ebayDetailToBrowse({ ...baseRaw, shippingCents: null, shipToLocations: null });
		expect(out?.estimatedAvailabilities?.[0]?.deliveryOptions).toBeUndefined();
	});
});
