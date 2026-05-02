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

	it("detects the Authenticity Guarantee block and pulls the visible description", () => {
		// Mirrors the real PDP markup eBay emits for AG-qualified listings
		// (sneakers / handbags / watches): the program icon symbol is referenced
		// by `<use href="#icon-authenticity-guarantee-...">` inside a
		// `[data-testid="ux-section-icon-with-details"]` trust panel block whose
		// `__data-item-text` row carries the user-facing copy.
		const html = `<!doctype html><html><body>
			<div data-testid="ux-section-icon-with-details" class="ux-section-icon-with-details">
				<svg><use href="#icon-authenticity-guarantee-24" /></svg>
				<div class="ux-section-icon-with-details__data-title">
					<span class="ux-textspans">Authenticity Guarantee</span>
				</div>
				<div class="ux-section-icon-with-details__data-item-text">
					<span class="ux-textspans ux-textspans--SECONDARY">This item is shipped to an eBay authenticator before delivery.</span>
				</div>
			</div>
			<h1 id="itemTitle">Test</h1>
			</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.authenticityGuarantee).toEqual({
			description: "This item is shipped to an eBay authenticator before delivery.",
		});
	});

	it("returns null authenticityGuarantee on listings without the AG icon", () => {
		const html = `<!doctype html><html><body><h1 id="itemTitle">Test</h1></body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.authenticityGuarantee).toBeNull();
	});

	it("pulls shortDescription from <meta name=description>", () => {
		const html = `<!doctype html><html><head>
			<meta name="description" content="The Air Jordan 4 Retro Black Cat brings back one of the most understated icons." />
			</head><body><h1 id="itemTitle">Test</h1></body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.shortDescription).toBe(
			"The Air Jordan 4 Retro Black Cat brings back one of the most understated icons.",
		);
	});

	it("falls back to <title> minus '| eBay' when meta description is absent", () => {
		// eBay's PDP rendering occasionally omits the meta tag. <title> is
		// always present (browsers require it) and carries the listing
		// title plus a fixed " | eBay" suffix.
		const html = `<!doctype html><html><head>
			<title>Pokemon Chaos Rising Booster Box New Sealed PRESALE 5/22/26 | eBay</title>
			</head><body><h1 id="itemTitle">Test</h1></body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.shortDescription).toBe("Pokemon Chaos Rising Booster Box New Sealed PRESALE 5/22/26");
	});

	it("normalizes payment brand names from PDP icon attrs", () => {
		// eBay encodes each brand as `<span class="ux-textspans--<KEY>" title="…" aria-label="…">`.
		// Spelling differs across brands (PayPal vs Paypal Credit, "Master Card" vs Mastercard);
		// the extractor maps every observed string to a canonical UPPER_SNAKE key.
		const html = `<!doctype html><html><body>
			<h1 id="itemTitle">Test</h1>
			<div>
				<span class="ux-textspans--PAYPAL" title="PayPal" aria-label="PayPal"></span>
				<span class="ux-textspans--PAYPAL_CREDIT" title="Paypal Credit" aria-label="Paypal Credit"></span>
				<span class="ux-textspans--GOOGLE_PAY" title="Google Pay" aria-label="Google Pay"></span>
				<span class="ux-textspans--VISA" title="Visa" aria-label="Visa"></span>
				<span class="ux-textspans--MASTERCARD" title="Master Card" aria-label="Master Card"></span>
				<span class="ux-textspans--DISCOVER" title="Discover" aria-label="Discover"></span>
			</div>
			</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.paymentBrands).toEqual(["PAYPAL", "PAYPAL_CREDIT", "GOOGLE_PAY", "VISA", "MASTERCARD", "DISCOVER"]);
	});

	it("parses shipToLocations from the shipping section JSON", () => {
		// Real eBay PDPs embed the Ships to / Excludes lists inside a JSON
		// blob. The extractor walks the raw HTML (not the DOM) because the
		// payload lives inside a `<script>` text node; this fixture mimics
		// the shape we observed on the live page.
		const html =
			`<!doctype html><html><body><h1 id="itemTitle">Test</h1>` +
			`<script>{"label":[{"_type":"TextSpan","text":"Ships to"}],"values":[{"_type":"ExpandableTextualDisplayBlock","textualDisplays":[{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"United States, Canada, Australia"}]}]}]}</script>` +
			`<script>{"label":[{"_type":"TextSpan","text":"Excludes"}],"values":[{"_type":"ExpandableTextualDisplayBlock","textualDisplays":[{"_type":"TextualDisplay","textSpans":[{"_type":"TextSpan","text":"Russian Federation, Ukraine"}]}]}]}</script>` +
			`</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.shipToLocations).toEqual({
			regionIncluded: [{ regionName: "United States" }, { regionName: "Canada" }, { regionName: "Australia" }],
			regionExcluded: [{ regionName: "Russian Federation" }, { regionName: "Ukraine" }],
		});
	});

	it("reads immediatePay + guestCheckout from SEMANTIC_DATA", () => {
		const html =
			`<!doctype html><html><body><h1 id="itemTitle">Test</h1>` +
			`<script>{"SEMANTIC_DATA":{"_type":"SemanticData","listingId":"1","listingStatus":"ACTIVE","immediatePay":true,"guestCheckout":true}}</script>` +
			`</body></html>`;
		const detail = parseEbayDetailHtml(html, "https://www.ebay.com/itm/1", jsdomFactory);
		expect(detail.immediatePay).toBe(true);
		expect(detail.guestCheckout).toBe(true);
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
