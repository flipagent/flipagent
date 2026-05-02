import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type BrowseLayoutItem,
	buildBrowseLayoutUrl,
	extractBrowseLayoutCards,
	parseEbayBrowseLayoutHtml,
} from "../src/ebay-browse-layout.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("eBay browse-layout (/b/_/<id>) parser", () => {
	it("builds the bare browse URL with `_` slug placeholder", () => {
		// eBay normalizes the slug server-side, so `/b/_/15709` 200s and
		// rewrites to `/b/Mens-Sneakers/15709/bn_57918`. The URL stays
		// bare — looking up the canonical slug client-side would race
		// eBay's renames.
		expect(buildBrowseLayoutUrl("15709")).toBe("https://www.ebay.com/b/_/15709");
	});

	it("builds page / sort / condition / BIN params for full-spec category browse", () => {
		const url = buildBrowseLayoutUrl("15709", {
			page: 2,
			sort: "pricePlusShippingLowest",
			binOnly: true,
			conditionIds: ["1000", "3000"],
		});
		const u = new URL(url);
		expect(u.pathname).toBe("/b/_/15709");
		expect(u.searchParams.get("_pgn")).toBe("2");
		expect(u.searchParams.get("_sop")).toBe("15");
		expect(u.searchParams.get("LH_BIN")).toBe("1");
		expect(u.searchParams.get("LH_ItemCondition")).toBe("1000|3000");
	});

	it("omits page=1 (default) and empty option bags", () => {
		expect(buildBrowseLayoutUrl("15709", { page: 1 })).toBe("https://www.ebay.com/b/_/15709");
		expect(buildBrowseLayoutUrl("15709", { conditionIds: [] })).toBe("https://www.ebay.com/b/_/15709");
	});

	it("extracts cards from the inline $brwweb_C hydration script", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-browse-layout.html"), "utf8");
		const cards = extractBrowseLayoutCards(html);
		// Fixture has 4 cards (3 real + 1 filler without listingId).
		expect(cards.length).toBe(4);
	});

	it("parses richest card to REST item_summary shape with marketingPrice + conditionId", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-browse-layout.html"), "utf8");
		const items = parseEbayBrowseLayoutHtml(html);
		expect(items).toHaveLength(3); // filler skipped
		const iphone = items.find((i) => i.legacyItemId === "100000000001");
		if (!iphone) throw new Error("expected iphone card");

		// REST item_summary core fields
		expect(iphone.itemId).toBe("v1|100000000001|0");
		expect(iphone.title).toContain("iPhone 13");
		expect(iphone.price?.value).toBe("265.00");
		expect(iphone.price?.currency).toBe("USD");
		expect(iphone.condition).toBe("Very Good - Refurbished");
		expect(iphone.conditionId).toBe("2020"); // mapped to eBay enum
		expect(iphone.shippingOptions?.[0]?.shippingCost?.value).toBe("0.00");
		expect(iphone.image?.imageUrl).toBe("https://i.ebayimg.com/images/g/AAA/s-l400.webp");
		expect(iphone.thumbnailImages).toHaveLength(2);
		expect(iphone.buyingOptions).toEqual(["FIXED_PRICE"]);
		expect(iphone.watchCount).toBe(77);
		expect(iphone.totalSoldQuantity).toBe(640);
		expect(iphone.epid).toBe("12345");

		// Beyond-REST signals (typed on BrowseLayoutItem)
		const browseItem = iphone as BrowseLayoutItem;
		expect(browseItem.marketingPrice?.originalPrice.value).toBe("799.99");
		expect(browseItem.marketingPrice?.discountPercentage).toBe("67");
		expect(browseItem.sponsored).toBe(true);
		expect(browseItem.certifiedRefurbished).toBe(true);
		expect(browseItem.reviewRating).toBe(4.5);
		expect(browseItem.reviewCount).toBe(31);
		expect(browseItem.subtitle).toBe("Free 2-Day Shipping");
		expect(browseItem.variationId).toBe("99999");
		expect(browseItem.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity).toBe(5);
	});

	it("infers BEST_OFFER from purchaseOptions and lastOne -> availability=1", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-browse-layout.html"), "utf8");
		const items = parseEbayBrowseLayoutHtml(html);
		const acer = items.find((i) => i.legacyItemId === "100000000003");
		if (!acer) throw new Error("expected acer card");
		expect(acer.condition).toBe("Good - Refurbished");
		expect(acer.conditionId).toBe("2030");
		expect(acer.buyingOptions).toEqual(["FIXED_PRICE", "BEST_OFFER"]);
		const browseItem = acer as BrowseLayoutItem;
		expect(browseItem.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity).toBe(1);
	});

	it("extracts items without listingCondition (sneakers-style cards)", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-browse-layout.html"), "utf8");
		const items = parseEbayBrowseLayoutHtml(html);
		const lems = items.find((i) => i.legacyItemId === "100000000002");
		if (!lems) throw new Error("expected lems card");
		// Sneakers categories don't surface listingCondition — verify the
		// rest of the card still extracts cleanly.
		expect(lems.condition).toBeUndefined();
		expect(lems.title).toContain("Brand New");
		expect(lems.price?.value).toBe("150.00");
		expect(lems.totalSoldQuantity).toBe(25);
		expect(lems.shippingOptions?.[0]?.shippingCost?.value).toBe("30.00");
	});

	it("skips cards without listingId (filler placeholders)", async () => {
		const html = await readFile(join(here, "fixtures", "ebay-browse-layout.html"), "utf8");
		const items = parseEbayBrowseLayoutHtml(html);
		expect(items.find((i) => i.title === "Filler card without listingId")).toBeUndefined();
	});

	it("returns empty array when no hydration script is present", async () => {
		expect(parseEbayBrowseLayoutHtml("<html><body><h1>nothing here</h1></body></html>")).toEqual([]);
	});

	it("returns empty array when hydration script has no ITEMS_LIST module (meta-category landing)", async () => {
		// Top-level / meta categories (e.g. `/b/_/281` for Jewelry &
		// Watches) render a subcategory grid, not a card list. The
		// hydration payload still ships but lacks ITEMS_LIST_*.
		const html =
			'<script>$brwweb_C=(window.$brwweb_C||[]).concat({"w":[["s0",1,{"model":{"modules":{"OTHER_MODULE":{"_type":"X"}}}}]]});</script>';
		expect(parseEbayBrowseLayoutHtml(html)).toEqual([]);
	});
});
