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

	it("extracts the full-res URL from `data-zoom-src` even when `src` is a lazy-load placeholder", () => {
		// Modern eBay listings serve a 1x1 GIF in `src` until the user
		// scrolls; the actual hero image hides in `data-zoom-src`. Make
		// sure the extractor reaches that attribute (regression for the
		// "image doesn't show in evaluate" bug we hit on the GUCCI YA1264153
		// listing where every selector match had a placeholder src).
		const html = `<!doctype html><html><body>
			<div class="ux-image-carousel-container">
				<div class="ux-image-carousel-item">
					<img
						src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
						data-zoom-src="https://i.ebayimg.com/images/g/abc/s-l1600.jpg"
						srcset="https://i.ebayimg.com/images/g/abc/s-l64.jpg 64w, https://i.ebayimg.com/images/g/abc/s-l500.jpg 500w"
					/>
				</div>
				<div class="ux-image-carousel-item">
					<img src="" data-zoom-src="https://i.ebayimg.com/images/g/abc/s-l1600-2.jpg" />
				</div>
			</div>
			<h1 id="itemTitle">Test</h1>
			</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/406338886641", jsdomFactory);
		expect(detail.imageUrls).toEqual([
			"https://i.ebayimg.com/images/g/abc/s-l1600.jpg",
			"https://i.ebayimg.com/images/g/abc/s-l1600-2.jpg",
		]);
	});

	it("falls back to `srcset` highest-density when no zoom-src/data-src is set", () => {
		const html = `<!doctype html><html><body>
			<div class="ux-image-carousel-container">
				<img srcset="https://i.ebayimg.com/x/s-l64.jpg 64w, https://i.ebayimg.com/x/s-l500.jpg 500w" />
			</div>
			<h1 id="itemTitle">Test</h1>
			</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.imageUrls).toEqual(["https://i.ebayimg.com/x/s-l500.jpg"]);
	});

	it("parses MSKU multi-variation block: ids, prices, per-axis aspects, selected", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-detail-msku.html"), "utf8");
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/357966166544?var=626382683495", jsdomFactory);
		expect(detail.variations).not.toBeNull();
		expect(detail.variations).toHaveLength(2);
		const us8 = detail.variations?.find((v) => v.variationId === "626382683495");
		const ps3y = detail.variations?.find((v) => v.variationId === "626578342371");
		expect(us8).toEqual({
			variationId: "626382683495",
			priceCents: 35990,
			currency: "USD",
			aspects: [{ name: "Size", value: "US M8 / W9.5 ( FV5029-010)" }],
		});
		expect(ps3y).toEqual({
			variationId: "626578342371",
			priceCents: 13500,
			currency: "USD",
			aspects: [{ name: "Size", value: "PS 3Y / W4.5 (IB4388-010)" }],
		});
		expect(detail.selectedVariationId).toBe("626382683495");
	});

	it("returns null variations on a single-SKU listing (no MSKU block)", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-detail.html"), "utf8");
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/Canon-EF-50mm/123456789012", jsdomFactory);
		expect(detail.variations).toBeNull();
		expect(detail.selectedVariationId).toBeNull();
	});

	it("skips data: URIs and known placeholder paths", () => {
		const html = `<!doctype html><html><body>
			<div class="ux-image-carousel-container">
				<img src="data:image/gif;base64,R0lGODlh" />
				<img src="https://example.com/placeholder.gif" />
				<img src="https://example.com/spacer.gif" />
				<img src="https://i.ebayimg.com/real.jpg" />
			</div>
			<h1 id="itemTitle">Test</h1>
			</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.imageUrls).toEqual(["https://i.ebayimg.com/real.jpg"]);
	});
});
