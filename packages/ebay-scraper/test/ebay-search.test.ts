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
import { parseEbaySearchHtml } from "../src/ebay-search.js";

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
