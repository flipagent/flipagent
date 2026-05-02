/**
 * Parser for eBay's `/b/<slug>/<categoryId>` category-browse pages.
 * Used for the category-only Sourcing flow (no keyword, just a
 * category id) — the keyword search-results path lives in
 * `ebay-search.ts`.
 *
 * The page ships its result list as a hydration payload inside an
 * inline script:
 *
 *   <script>
 *     $brwweb_C=(window.$brwweb_C||[]).concat({
 *       w: [[..., {model: {modules: {ITEMS_LIST_VERTICAL_1: {
 *         containers: [{cards: [<ListingItemCard>, ...]}]
 *       }}}}]]
 *     });
 *   </script>
 *
 * Each `ListingItemCard` carries a structurally clean record:
 *   - `listingId`, `title.textSpans[].text`, `displayPrice.value.value`
 *     (numeric), `previousPrice`, `listingCondition`, `imageContainer`,
 *     `__search.{watchCountTotal, subTitle, certifiedRefurbished, lastOne}`,
 *     `itemHotness` ("N sold"), `sponsoredInfo`, `productReview`,
 *     `purchaseOptions`, `quantity`, `action.URL` (carries epid + var).
 *
 * We map each card to `EbayItemSummary` so the resource service sees
 * the same shape as `/buy/browse/v1/item_summary/search`. The JSON
 * keys are part of eBay's SPA hydration model rather than a public
 * contract, so prod monitoring on `extractCardCount / parsedItemCount`
 * is recommended — a sudden drop is the early signal of a redesign.
 */

import type { EbayItemSummary } from "./ebay-search.js";

// `g` flag is required for `String.prototype.matchAll`. Capture group 2
// is the script body; capture group 1 (the attribute string) is unused
// but kept for clarity at the regex level.
const SCRIPT_TAG_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
const CONCAT_HEAD_RE = /\$brwweb_C\s*=\s*\(\s*window\.\$brwweb_C\s*\|\|\s*\[\s*\]\s*\)\s*\.concat\s*\(/;

/**
 * Bracket-balanced JSON extraction for the body passed into
 * `$brwweb_C.concat({...})`. The hydration payload has nested
 * curly-brace structures, escaped quotes, and embedded URLs — naïve
 * regex won't terminate correctly, so we scan with a depth counter
 * and a string-state flag.
 */
function extractConcatBlob(scriptBody: string): unknown | null {
	const head = CONCAT_HEAD_RE.exec(scriptBody);
	if (!head) return null;
	const startIdx = scriptBody.indexOf("{", head.index + head[0].length);
	if (startIdx < 0) return null;
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = startIdx; i < scriptBody.length; i++) {
		const ch = scriptBody.charCodeAt(i);
		if (esc) {
			esc = false;
			continue;
		}
		if (ch === 92 /* \\ */) {
			esc = true;
			continue;
		}
		if (ch === 34 /* " */) {
			inStr = !inStr;
			continue;
		}
		if (inStr) continue;
		if (ch === 123 /* { */) depth++;
		else if (ch === 125 /* } */) {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(scriptBody.slice(startIdx, i + 1));
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

/**
 * Walk the hydration payload looking for an `ITEMS_LIST_*` module.
 * eBay names them `ITEMS_LIST_VERTICAL_1` / `ITEMS_LIST_GRID_1` /
 * variants — match by prefix so renames don't break us.
 */
function findItemsListCards(payload: unknown): unknown[] {
	if (!isObject(payload)) return [];
	const w = (payload as { w?: unknown }).w;
	if (!Array.isArray(w)) return [];
	for (const wEntry of w) {
		if (!Array.isArray(wEntry)) continue;
		// `[ "<key>", <something>, { model: { modules: { ITEMS_LIST_*: {...} } } } ]`
		for (const tuple of wEntry) {
			if (!isObject(tuple)) continue;
			const model = (tuple as { model?: unknown }).model;
			if (!isObject(model)) continue;
			const modules = (model as { modules?: unknown }).modules;
			if (!isObject(modules)) continue;
			for (const key of Object.keys(modules as Record<string, unknown>)) {
				if (!key.startsWith("ITEMS_LIST")) continue;
				const mod = (modules as Record<string, unknown>)[key];
				if (!isObject(mod)) continue;
				const containers = (mod as { containers?: unknown }).containers;
				if (!Array.isArray(containers)) continue;
				for (const container of containers) {
					if (!isObject(container)) continue;
					const cards = (container as { cards?: unknown }).cards;
					if (Array.isArray(cards)) return cards;
				}
			}
		}
	}
	return [];
}

/**
 * Find the first `<script>$brwweb_C=...concat({...})</script>` block
 * on the page that carries an `ITEMS_LIST_*` module. Multiple
 * `$brwweb_C` scripts coexist — header chrome, footer modules, ads.
 * The right one is identified by the substring `ITEMS_LIST` in its
 * body (cheap pre-filter before bracket-counting).
 */
export function extractBrowseLayoutCards(html: string): unknown[] {
	for (const match of html.matchAll(SCRIPT_TAG_RE)) {
		const body = match[2] ?? "";
		if (!body.includes("$brwweb_C") || !body.includes("ITEMS_LIST")) continue;
		const blob = extractConcatBlob(body);
		if (!blob) continue;
		const cards = findItemsListCards(blob);
		if (cards.length > 0) return cards;
	}
	return [];
}

/* ----------------------------- card → summary ----------------------------- */

interface TextSpan {
	text?: string;
}
interface TextualDisplay {
	textSpans?: TextSpan[];
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textJoin(td: unknown): string | undefined {
	if (!isObject(td)) return undefined;
	const spans = (td as TextualDisplay).textSpans;
	if (!Array.isArray(spans)) return undefined;
	const out = spans
		.map((s) => (typeof s?.text === "string" ? s.text : ""))
		.join("")
		.trim();
	return out || undefined;
}

function moneyToDollarString(value: unknown, currency: unknown): { value: string; currency: string } | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const cur = typeof currency === "string" && currency ? currency : "USD";
	return { value: value.toFixed(2), currency: cur };
}

/**
 * `listingCondition.textSpans` is `[<condition>, " · ", <brand>]` for
 * laptops / phones (when present) or `[<condition>]` for simpler cards.
 * The first non-separator span is the condition; later spans are
 * variation/brand metadata we drop on the floor (REST doesn't surface
 * those in `item_summary` either).
 */
function extractCondition(card: Record<string, unknown>): string | undefined {
	const lc = card.listingCondition;
	if (!isObject(lc)) return undefined;
	const spans = (lc as TextualDisplay).textSpans;
	if (!Array.isArray(spans)) return undefined;
	for (const s of spans) {
		const t = (s?.text ?? "").trim();
		// "·" can appear with or without surrounding spaces depending on
		// layout. Strict-match the standalone separator only.
		if (t && t !== "·") return t;
	}
	return undefined;
}

/**
 * eBay's standard `conditionId` enum (the same one Browse REST
 * returns). Mapping covers the 12 strings the browse layout actually
 * emits today — anything else falls through (so callers can still see
 * `condition` even when conditionId is unmappable).
 */
const CONDITION_ID_MAP: Record<string, string> = {
	New: "1000",
	"Brand New": "1000",
	"New with tags": "1000",
	"New without tags": "1500",
	"New with defects": "1750",
	"New (other)": "1500",
	"Open Box": "1500",
	"Certified - Refurbished": "2000",
	"Manufacturer refurbished": "2000",
	"Excellent - Refurbished": "2010",
	"Very Good - Refurbished": "2020",
	"Good - Refurbished": "2030",
	"Seller refurbished": "2500",
	"Like New": "2750",
	Used: "3000",
	"Pre-Owned": "3000",
	"Pre-owned": "3000",
	"Very Good": "4000",
	Good: "5000",
	Acceptable: "6000",
	"For parts or not working": "7000",
};

function extractWatchCount(searchModule: unknown): number | undefined {
	if (!isObject(searchModule)) return undefined;
	const wc = searchModule.watchCountTotal;
	if (!isObject(wc)) return undefined;
	const text = textJoin(wc.text);
	if (!text) return undefined;
	const m = /(\d+(?:,\d+)*)/.exec(text);
	return m ? Number.parseInt(m[1]!.replace(/,/g, ""), 10) : undefined;
}

/**
 * Sold count rides on `itemHotness` ("52 sold" / "1,247 sold") with
 * the REDHOT icon. Other hotness text variants exist in theory but
 * we've only ever observed the sold form on `/b/`.
 */
function extractTotalSoldQuantity(card: Record<string, unknown>): number | undefined {
	const hot = card.itemHotness;
	if (isObject(hot)) {
		const text = textJoin(hot.text);
		if (text) {
			const m = /(\d+(?:,\d+)*)\+?\s+sold/i.exec(text);
			if (m) return Number.parseInt(m[1]!.replace(/,/g, ""), 10);
		}
	}
	const q = textJoin(card.quantity);
	if (q) {
		const m = /(\d+(?:,\d+)*)\+?\s+sold/i.exec(q);
		if (m) return Number.parseInt(m[1]!.replace(/,/g, ""), 10);
	}
	return undefined;
}

function extractShipping(card: Record<string, unknown>): EbayItemSummary["shippingOptions"] | undefined {
	const text = textJoin(card.logisticsCost);
	if (!text) return undefined;
	if (/free/i.test(text)) {
		return [{ shippingCost: { value: "0.00", currency: "USD" } }];
	}
	const m = /\$([0-9][0-9,]*\.?\d*)/.exec(text);
	if (!m) return undefined;
	return [{ shippingCost: { value: m[1]!.replace(/,/g, ""), currency: "USD" } }];
}

function extractImage(card: Record<string, unknown>): {
	image?: { imageUrl: string };
	thumbnailImages?: { imageUrl: string }[];
} {
	const ic = card.imageContainer;
	if (!isObject(ic)) return {};
	const out: { image?: { imageUrl: string }; thumbnailImages?: { imageUrl: string }[] } = {};
	const primary = ic.image;
	if (isObject(primary) && typeof primary.URL === "string") {
		out.image = { imageUrl: primary.URL };
	}
	const secondary = ic.secondaryImages;
	if (Array.isArray(secondary)) {
		const thumbs: { imageUrl: string }[] = [];
		for (const s of secondary) {
			if (isObject(s) && typeof s.URL === "string") thumbs.push({ imageUrl: s.URL });
		}
		if (thumbs.length > 0) out.thumbnailImages = thumbs;
	}
	return out;
}

function extractEpidAndVariation(card: Record<string, unknown>): { epid?: string; variationId?: string } {
	const action = card.action;
	let epid: string | undefined;
	let variationId: string | undefined;
	if (isObject(action)) {
		const params = action.params;
		if (isObject(params)) {
			if (typeof params.epid === "string") epid = params.epid;
			if (typeof params.var === "string") variationId = params.var;
		}
		if (!epid || !variationId) {
			const url = action.URL;
			if (typeof url === "string") {
				if (!epid) {
					const m = /[?&]epid=(\d+)/.exec(url);
					if (m) epid = m[1];
				}
				if (!variationId) {
					const m = /[?&]var=(\d+)/.exec(url);
					if (m) variationId = m[1];
				}
			}
		}
	}
	// EPID also appears on `/p/<epid>` deep links inside productReview.
	if (!epid) {
		const pr = card.productReview;
		if (isObject(pr)) {
			const reviews = pr.reviews;
			if (isObject(reviews) && isObject(reviews.action) && typeof reviews.action.URL === "string") {
				const m = /\/p\/(\d+)/.exec(reviews.action.URL);
				if (m) epid = m[1];
			}
		}
	}
	return { epid, variationId };
}

function extractBuyingOptions(card: Record<string, unknown>): EbayItemSummary["buyingOptions"] | undefined {
	const options: ("AUCTION" | "FIXED_PRICE" | "BEST_OFFER")[] = [];
	const poText = (textJoin(card.purchaseOptions) ?? "").toLowerCase();
	const bidText = (textJoin(card.bidStatus) ?? "").toLowerCase();
	if (/bid|auction/.test(poText) || /bid/.test(bidText)) {
		options.push("AUCTION");
	} else if (card.displayPrice) {
		options.push("FIXED_PRICE");
	}
	if (poText.includes("best offer")) options.push("BEST_OFFER");
	return options.length > 0 ? options : undefined;
}

/**
 * Some hydration cards carry a fallback `aria-label` title via an
 * image-carousel slide. Rare on the cards we've seen with `listingId`
 * already populated — kept as a defensive fallback for the redesigned
 * compare-style cards.
 */
function extractTitle(card: Record<string, unknown>): string | undefined {
	const titleField = card.title;
	const t = textJoin(titleField);
	if (t) return t;
	const ic = card.imageContainer;
	if (isObject(ic) && isObject(ic.image) && typeof ic.image.title === "string") {
		const stripped = ic.image.title.replace(/\s+-\s+Image\s+\d+\s+of\s+\d+\s*$/i, "").trim();
		return stripped || undefined;
	}
	return undefined;
}

export interface BrowseLayoutItem extends EbayItemSummary {
	/**
	 * Strikethrough "Was: $X" original price + computed discount %.
	 * REST `item_summary` doesn't include this; we surface it because
	 * arbitrage callers want the deal signal directly. Mirrors the
	 * shape eBay's Browse `getItem` detail returns under `marketingPrice`.
	 */
	marketingPrice?: {
		originalPrice: { value: string; currency: string };
		discountPercentage?: string;
	};
	/** eBay's "Genuine Windows 11 OS! Free shipping!" seller free-text annotation. */
	subtitle?: string;
	/** `__search.certifiedRefurbished` badge present. */
	certifiedRefurbished?: boolean;
	/** Catalog-product review aggregate from `productReview.reviews.value` (1-5). */
	reviewRating?: number;
	/** Catalog-product review count from `productReview.reviewCount.value`. */
	reviewCount?: number;
	/** Variation id from `action.URL?var=...` — surfaces multi-SKU listings. */
	variationId?: string;
	/** Card has `sponsoredInfo` block (real signal, not the obfuscated CSS span). */
	sponsored?: boolean;
	/** Quantity remaining ("10 remaining" → 10; `__search.lastOne` → 1). */
	estimatedAvailabilities?: { estimatedAvailableQuantity: number }[];
}

export function browseLayoutCardToSummary(card: unknown): BrowseLayoutItem | null {
	if (!isObject(card)) return null;
	const listingId = typeof card.listingId === "string" ? card.listingId : undefined;
	if (!listingId) return null;
	const title = extractTitle(card);
	// "Shop on eBay" is eBay's first-slot promo placeholder, not a real
	// listing. The hydration payload usually omits it entirely (cards
	// here are real items), but the title check is a cheap defense.
	if (!title || title === "Shop on eBay") return null;

	const action = card.action;
	const actionUrl = isObject(action) && typeof action.URL === "string" ? action.URL : undefined;
	const out: BrowseLayoutItem = {
		itemId: `v1|${listingId}|0`,
		legacyItemId: listingId,
		title,
		itemWebUrl: actionUrl ?? `https://www.ebay.com/itm/${listingId}`,
	};

	const { epid, variationId } = extractEpidAndVariation(card);
	if (epid) out.epid = epid;
	if (variationId) out.variationId = variationId;

	const dp = card.displayPrice;
	if (isObject(dp)) {
		const v = dp.value;
		if (isObject(v)) {
			const m = moneyToDollarString(v.value, v.currency);
			if (m) out.price = m;
		}
	}

	const prev = card.previousPrice;
	if (isObject(prev)) {
		const v = prev.value;
		if (isObject(v)) {
			const original = moneyToDollarString(v.value, v.currency);
			if (original) {
				out.marketingPrice = { originalPrice: original };
				if (out.price) {
					const cur = Number.parseFloat(out.price.value);
					const old = Number.parseFloat(original.value);
					if (Number.isFinite(cur) && Number.isFinite(old) && old > cur) {
						out.marketingPrice.discountPercentage = String(Math.round(((old - cur) / old) * 100));
					}
				}
			}
		}
	}

	const cond = extractCondition(card);
	if (cond) {
		out.condition = cond;
		const cid = CONDITION_ID_MAP[cond];
		if (cid) out.conditionId = cid;
	}

	const shipping = extractShipping(card);
	if (shipping) out.shippingOptions = shipping;

	const imgs = extractImage(card);
	if (imgs.image) out.image = imgs.image;
	if (imgs.thumbnailImages) out.thumbnailImages = imgs.thumbnailImages;

	const buyingOptions = extractBuyingOptions(card);
	if (buyingOptions) out.buyingOptions = buyingOptions;

	const search = card.__search;
	const wc = extractWatchCount(search);
	if (wc !== undefined) out.watchCount = wc;

	const sold = extractTotalSoldQuantity(card);
	if (sold !== undefined) out.totalSoldQuantity = sold;

	if (card.sponsoredInfo) out.sponsored = true;

	if (isObject(search)) {
		const sub = search.subTitle;
		if (isObject(sub) && typeof sub.text === "string" && sub.text.trim()) {
			out.subtitle = sub.text.trim();
		}
		if (search.certifiedRefurbished) out.certifiedRefurbished = true;
	}

	const pr = card.productReview;
	if (isObject(pr)) {
		const reviews = pr.reviews;
		if (isObject(reviews) && typeof reviews.value === "number") {
			out.reviewRating = reviews.value;
		}
		const rc = pr.reviewCount;
		if (isObject(rc) && typeof rc.value === "number") {
			out.reviewCount = rc.value;
		}
	}

	let availability: number | undefined;
	const qText = textJoin(card.quantity);
	if (qText) {
		const m = /(\d+(?:,\d+)*)\s+remaining/i.exec(qText);
		if (m) availability = Number.parseInt(m[1]!.replace(/,/g, ""), 10);
	}
	if (availability === undefined && isObject(search) && search.lastOne) {
		availability = 1;
	}
	if (availability !== undefined) {
		out.estimatedAvailabilities = [{ estimatedAvailableQuantity: availability }];
	}

	return out;
}

export interface BrowseLayoutUrlParams {
	/** 1-based page index. Each page ships ~60 cards. */
	page?: number;
	/**
	 * Sort key. Web-side parameter `_sop`:
	 *   `endingSoonest` → 1, `newlyListed` → 10,
	 *   `pricePlusShippingLowest` → 15, `pricePlusShippingHighest` → 16.
	 */
	sort?: "endingSoonest" | "newlyListed" | "pricePlusShippingLowest" | "pricePlusShippingHighest";
	/** Restrict to fixed-price listings. Maps to `LH_BIN=1`. */
	binOnly?: boolean;
	/** Restrict to auction listings. Maps to `LH_Auction=1`. */
	auctionOnly?: boolean;
	/**
	 * Pipe-joined Browse REST condition ids (e.g. `["1000", "3000"]`).
	 * Maps to `LH_ItemCondition=<id>|<id>`.
	 */
	conditionIds?: string[];
	/** Narrow to a sub-category id. Maps to `_dcat=<id>`. */
	subCategoryId?: string;
}

/**
 * Build a category-browse URL. The slug part is irrelevant — eBay
 * normalizes server-side, so `_` as a placeholder lets callers skip
 * a category-id → slug lookup. `/b/_/15709` resolves to
 * `/b/Mens-Sneakers/15709/bn_57918`.
 */
export function buildBrowseLayoutUrl(categoryId: string, params: BrowseLayoutUrlParams = {}): string {
	const u = new URL(`https://www.ebay.com/b/_/${encodeURIComponent(categoryId)}`);
	if (params.page && params.page > 1) u.searchParams.set("_pgn", String(params.page));
	if (params.sort) {
		const code = SORT_MAP[params.sort];
		if (code) u.searchParams.set("_sop", code);
	}
	if (params.binOnly) u.searchParams.set("LH_BIN", "1");
	if (params.auctionOnly) u.searchParams.set("LH_Auction", "1");
	if (params.conditionIds && params.conditionIds.length > 0) {
		u.searchParams.set("LH_ItemCondition", params.conditionIds.join("|"));
	}
	if (params.subCategoryId) u.searchParams.set("_dcat", params.subCategoryId);
	return u.toString();
}

const SORT_MAP: Record<NonNullable<BrowseLayoutUrlParams["sort"]>, string> = {
	endingSoonest: "1",
	newlyListed: "10",
	pricePlusShippingLowest: "15",
	pricePlusShippingHighest: "16",
};

/**
 * Parse a full browse-layout HTML page into REST-shape item summaries.
 * `null` cards (placeholders / fillers without a `listingId`) are
 * filtered out. Empty array means either the page is a meta-category
 * landing (subcategory grid, no items) or eBay shipped a redesign and
 * `ITEMS_LIST_*` moved.
 */
export function parseEbayBrowseLayoutHtml(html: string): EbayItemSummary[] {
	const cards = extractBrowseLayoutCards(html);
	const out: EbayItemSummary[] = [];
	for (const c of cards) {
		const item = browseLayoutCardToSummary(c);
		if (item) out.push(item);
	}
	return out;
}
