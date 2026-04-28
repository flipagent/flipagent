import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseEbayDetailHtml } from "../src/ebay-search.js";

const here = dirname(fileURLToPath(import.meta.url));
function jsdomFactory(html: string): ParentNode {
	return new JSDOM(html).window.document;
}

describe("eBay detail extractor", () => {
	it("parses price, bids, time left, watchers, seller, category", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-detail.html"), "utf8");
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/Canon-EF-50mm/123456789012", jsdomFactory);
		expect(detail.itemId).toBe("123456789012");
		expect(detail.title).toContain("Canon EF 50mm");
		expect(detail.priceCents).toBe(9500);
		expect(detail.currency).toBe("USD");
		expect(detail.shippingCents).toBe(499);
		expect(detail.condition).toBe("Used");
		expect(detail.bidCount).toBe(3);
		expect(detail.timeLeftText).toContain("20m");
		expect(detail.watchCount).toBe(7);
		expect(detail.seller.name).toBe("canon_store_us");
		expect(detail.seller.feedbackScore).toBe(12345);
		expect(detail.seller.feedbackPercent).toBeCloseTo(99.8, 1);
		expect(detail.categoryPath).toContain("Camera Lenses");
		expect(detail.imageUrls.length).toBeGreaterThanOrEqual(2);
	});
});
