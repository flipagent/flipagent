import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
	endDateFromTimeLeft,
	hasBestOfferFormat,
	normalizeBuyingFormat,
	parseFeedbackScore,
	timeLeftFromEndDate,
} from "../src/ebay-extract.js";
import { buildEbayUrl, parseEbaySearchHtml } from "../src/ebay-search.js";

const here = dirname(fileURLToPath(import.meta.url));

function jsdomFactory(html: string): ParentNode {
	return new JSDOM(html).window.document;
}

describe("eBay search extractor — legacy s-item layout", () => {
	it("parses sold items into canonical EbayItemSummary shape (price.value, shippingOptions, lastSoldDate)", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-search-sold.html"), "utf8");
		const items = parseEbaySearchHtml(html, { keyword: "trek", soldOnly: true }, jsdomFactory);
		expect(items).toHaveLength(2);
		const [first, second] = items;
		if (!first || !second) throw new Error("expected two items");

		expect(first.itemId).toBe("v1|123456789012|0");
		expect(first.legacyItemId).toBe("123456789012");
		expect(first.title).toContain("Trek Fuel EX 7");
		expect(first.itemWebUrl).toContain("/itm/123456789012");
		expect(first.condition).toBe("Used");
		expect(first.price?.value).toBe("625.00");
		expect(first.price?.currency).toBe("USD");
		expect(first.shippingOptions?.[0]?.shippingCost?.value).toBe("49.99");
		expect(first.lastSoldDate?.slice(0, 10)).toBe("2026-04-12");

		expect(second.shippingOptions?.[0]?.shippingCost?.value).toBe("0.00"); // "Free shipping"
		expect(second.lastSoldDate?.slice(0, 10)).toBe("2026-03-03");
	});

	it("skips the Shop-on-eBay placeholder row", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-search-sold.html"), "utf8");
		const items = parseEbaySearchHtml(html, { keyword: "trek", soldOnly: false }, jsdomFactory);
		expect(items.every((i) => !i.title.toLowerCase().includes("shop on ebay"))).toBe(true);
	});
});

describe("eBay search extractor — modern s-card layout (2025+)", () => {
	it("parses watcher count, seller feedback, buying option, time-left, and sanitizes title", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-search-modern.html"), "utf8");
		const items = parseEbaySearchHtml(html, { keyword: "canon 50mm" }, jsdomFactory);
		expect(items).toHaveLength(2);
		const [first, second] = items;
		if (!first || !second) throw new Error("expected two cards");

		// Title sanitizer strips both "New Listing" prefix and screen-reader suffix
		expect(first.title).toBe("Canon EF 50mm f/1.8 STM Lens");
		expect(first.itemId).toBe("v1|111111111111|0");
		expect(first.legacyItemId).toBe("111111111111");
		expect(first.price?.value).toBe("75.00");
		expect(first.price?.currency).toBe("USD");
		expect(first.shippingOptions?.[0]?.shippingCost?.value).toBe("6.51");
		expect(first.condition).toContain("Pre-Owned");
		expect(first.watchCount).toBe(14);
		expect(first.seller?.feedbackScore).toBe(280_100);
		expect(first.buyingOptions).toEqual(["FIXED_PRICE"]);
		expect(first.itemEndDate).toBeTruthy();
		const endsAtMs = Date.parse(first.itemEndDate!);
		const expectedMs = Date.now() + (2 * 60 + 15) * 60_000;
		expect(Math.abs(endsAtMs - expectedMs)).toBeLessThan(60_000);

		expect(second.title).toBe("Canon EF 50mm f/1.4 USM Lens");
		expect(second.price?.value).toBe("329.99");
		expect(second.shippingOptions?.[0]?.shippingCost?.value).toBe("0.00");
		// "or Best Offer" attribute row → FIXED_PRICE + BEST_OFFER, mirroring
		// what eBay's Browse REST returns for the same listing shape.
		expect(second.buyingOptions).toEqual(["FIXED_PRICE", "BEST_OFFER"]);
		expect(second.seller?.feedbackScore).toBe(14_500);
	});
});

describe("eBay search extractor — Authenticity Guarantee", () => {
	// Minimal modern `.s-card` listing carrying an AG icon ref but no
	// seller-feedback row — eBay's actual SRP shape for AG-routed
	// luxury watches / sneakers / handbags. Production data is 0/N
	// "X% positive" rows in this layout, so the AG badge is the only
	// trust signal available.
	const AG_CARD_HTML = `
<html><body><ul class="srp-results srp-list">
  <li class="s-card s-card--vertical" data-listingid="377153137412">
    <div>
      <a class="s-card__link" href="https://www.ebay.com/itm/377153137412">
        <span class="s-card__title">Breitling Colt Automatic A17380 Black Dial 41mm</span>
      </a>
      <div class="s-card__price">$890.00</div>
      <div class="s-card__subtitle">Pre-Owned · Breitling</div>
      <div class="s-card__attribute-row">+$17.09 delivery</div>
      <div class="s-card__attribute-row">19 bids · Ends in 18h 6m</div>
      <div class="s-card__footer">
        <svg><use href="#icon-legacy-authenticity-guarantee-48-colored" /></svg>
        <span>Authenticity Guarantee</span>
      </div>
    </div>
  </li>
</ul></body></html>`;

	it("populates authenticityGuarantee + qualifiedPrograms when the AG icon is present", () => {
		const items = parseEbaySearchHtml(AG_CARD_HTML, { keyword: "breitling" }, jsdomFactory);
		expect(items).toHaveLength(1);
		const item = items[0]!;
		expect(item.authenticityGuarantee).toEqual({ description: "Authenticity Guarantee" });
		expect(item.qualifiedPrograms).toEqual(["AUTHENTICITY_GUARANTEE"]);
		// Seller block should remain absent — the SRP layout swaps the
		// feedback line for the AG badge entirely. We verify the absence
		// rather than synthesize a placeholder.
		expect(item.seller).toBeUndefined();
	});

	it("leaves AG fields undefined on non-AG modern cards", () => {
		const noAgHtml = AG_CARD_HTML.replace(/icon-legacy-authenticity-guarantee-48-colored/, "icon-other").replace(
			/Authenticity Guarantee/,
			"Free returns",
		);
		const items = parseEbaySearchHtml(noAgHtml, { keyword: "breitling" }, jsdomFactory);
		expect(items).toHaveLength(1);
		expect(items[0]!.authenticityGuarantee).toBeUndefined();
		expect(items[0]!.qualifiedPrograms).toBeUndefined();
	});
});

describe("ebay-extract pure helpers", () => {
	it("parseFeedbackScore: handles parenthesized count with K/M suffix and plain digits", () => {
		expect(parseFeedbackScore("robertscamera 99.7% positive (280.1K)")).toBe(280_100);
		expect(parseFeedbackScore("wdquality 100% positive (14.5K)")).toBe(14_500);
		expect(parseFeedbackScore("moha-6331 98% positive (94)")).toBe(94);
		expect(parseFeedbackScore("Bigseller 99% positive (1.2M)")).toBe(1_200_000);
		expect(parseFeedbackScore(null)).toBeNull();
	});

	it("normalizeBuyingFormat: maps both array and string inputs to canonical enum", () => {
		expect(normalizeBuyingFormat("Auction")).toBe("AUCTION");
		expect(normalizeBuyingFormat("Buy It Now")).toBe("FIXED_PRICE");
		expect(normalizeBuyingFormat("or Best Offer")).toBe("FIXED_PRICE");
		expect(normalizeBuyingFormat(["AUCTION"])).toBe("AUCTION");
		expect(normalizeBuyingFormat(null)).toBeNull();
		expect(normalizeBuyingFormat("Random text")).toBeNull();
	});

	it("hasBestOfferFormat: detects Best Offer signal independently of dominant format", () => {
		expect(hasBestOfferFormat("or Best Offer")).toBe(true);
		expect(hasBestOfferFormat("Buy It Now or Best Offer")).toBe(true);
		expect(hasBestOfferFormat(["Buy It Now", "or Best Offer"])).toBe(true);
		expect(hasBestOfferFormat("Buy It Now")).toBe(false);
		expect(hasBestOfferFormat("Auction")).toBe(false);
		expect(hasBestOfferFormat(null)).toBe(false);
	});

	it("endDateFromTimeLeft / timeLeftFromEndDate roundtrip", () => {
		const now = Date.parse("2026-04-25T00:00:00Z");
		const iso = endDateFromTimeLeft("Ends in 1d 4h", now);
		expect(iso).toBe("2026-04-26T04:00:00.000Z");
		const back = timeLeftFromEndDate(iso!, now);
		expect(back).toBe("1d 4h");
		expect(endDateFromTimeLeft("Ended", now)).toBeNull();
		expect(endDateFromTimeLeft(null, now)).toBeNull();
	});
});

describe("buildEbayUrl — eBay-spec params translated to web SRP", () => {
	it("emits the bare keyword + page URL with no extras when nothing's set", () => {
		const u = new URL(buildEbayUrl({ keyword: "canon ef 50mm" }, 1));
		expect(u.pathname).toBe("/sch/i.html");
		expect(u.searchParams.get("_nkw")).toBe("canon ef 50mm");
		expect(u.searchParams.get("_pgn")).toBe("1");
		// No category, no aspect facets, no LH_* flags
		const keys = [...u.searchParams.keys()].sort();
		expect(keys).toEqual(["_nkw", "_pgn"]);
	});

	it("nests categoryId in the path slug AND emits `_dcat` (canonical eBay form)", () => {
		const u = new URL(buildEbayUrl({ keyword: "jordan 4", categoryId: "15709" }, 1));
		expect(u.pathname).toBe("/sch/15709/i.html");
		expect(u.searchParams.get("_dcat")).toBe("15709");
	});

	it("emits aspect facets as URL params keyed by aspect name (URL-encoded)", () => {
		const u = new URL(
			buildEbayUrl(
				{
					keyword: "jordan 4",
					categoryId: "15709",
					aspectParams: { Color: "Black|Red", "US Shoe Size": "8" },
				},
				1,
			),
		);
		expect(u.searchParams.get("Color")).toBe("Black|Red");
		expect(u.searchParams.get("US Shoe Size")).toBe("8");
		// URLSearchParams encodes spaces as `+` (form encoding) and `|`
		// as `%7C`. Both forms are valid query-string encodings; eBay
		// accepts either.
		expect(u.toString()).toContain("US+Shoe+Size=8");
		expect(u.toString()).toContain("Color=Black%7CRed");
	});

	it("appends `extraKeywords` to `_nkw` for GTIN folding", () => {
		const u = new URL(buildEbayUrl({ keyword: "canon", extraKeywords: "0013803131093" }, 1));
		expect(u.searchParams.get("_nkw")).toBe("canon 0013803131093");
	});

	it("layers aspect / sold / condition flags together without conflict", () => {
		const u = new URL(
			buildEbayUrl(
				{
					keyword: "watch",
					soldOnly: true,
					conditionIds: ["1000", "3000"],
					sort: "newlyListed",
					categoryId: "31387",
					aspectParams: { Brand: "Rolex" },
				},
				2,
			),
		);
		expect(u.pathname).toBe("/sch/31387/i.html");
		expect(u.searchParams.get("_pgn")).toBe("2");
		expect(u.searchParams.get("LH_Sold")).toBe("1");
		expect(u.searchParams.get("LH_Complete")).toBe("1");
		expect(u.searchParams.get("LH_ItemCondition")).toBe("1000|3000");
		expect(u.searchParams.get("_sop")).toBe("10"); // newlyListed
		expect(u.searchParams.get("_dcat")).toBe("31387");
		expect(u.searchParams.get("Brand")).toBe("Rolex");
	});
});
