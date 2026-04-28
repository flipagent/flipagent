/**
 * Pure DOM extractors for eBay's public search + detail pages. Used as the
 * scraper-primary backend for every read-side eBay tool.
 *
 * eBay rotates layouts roughly yearly. Modern pages (2025+) use the
 * `s-card` web-component family: `<li class="s-card s-card--horizontal">` with
 * children like `.s-card__title`, `.s-card__price`, `.s-card__subtitle`,
 * `.s-card__attribute-row` (free-text rows: "14 watchers", "Free delivery",
 * "or Best Offer", "Sold Apr 5"), `.s-card__footer` (seller info). Older
 * `s-item` selectors are kept for fixtures and backward-compat with cached
 * fragments. When eBay redesigns again, this is the single file to update.
 */

export interface RawEbayItem {
	title: string;
	priceText: string | null;
	shippingText: string | null;
	/**
	 * Raw subtitle text from `.s-card__subtitle`. eBay packs canonical
	 * condition + item attributes into one ` · `-separated string, e.g.
	 * `"Brand New · Gucci G-Timeless · Stainless Steel"`. The
	 * `parseEbaySearchHtml` layer splits this into `condition` (canonical
	 * label, mapped to `conditionId`) + `itemAttributes` (model / material
	 * descriptors). Sellers may also write custom strings like
	 * `"100% New, Authentic Product from Direct Luxury"` — those don't
	 * match the canonical list and pass through as-is.
	 */
	subtitleText: string | null;
	url: string;
	soldDate: string | null;
	itemIdHint: string | null;
	bidCountText: string | null;
	timeLeftText: string | null;
	buyingFormat: string | null;
	watchCountText: string | null;
	sellerFeedbackText: string | null;
	imageUrl: string | null;
	soldQuantityText: string | null;
	/** True when the card carries a Top Rated Plus badge. */
	topRatedBuyingExperience: boolean;
}

function extractItemIdFromUrl(url: string): string | null {
	const match = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) ?? url.match(/[?&]item=(\d{9,})/);
	return match ? (match[1] ?? null) : null;
}

function firstText(root: Element, selectors: string[]): string | null {
	for (const sel of selectors) {
		const el = root.querySelector(sel);
		const t = el?.textContent?.trim();
		if (t) return t;
	}
	return null;
}

// Cards sometimes carry two `.s-card__subtitle` rows — first a seller
// marketing line ("100% New, Authentic Product from …"), then the
// canonical condition row ("Brand New · Gucci G-Timeless · Stainless
// Steel"). Prefer the row that `splitSubtitle` recognises as a canonical
// condition; fall back to the first row when none do.
function pickConditionSubtitle(root: Element): string | null {
	const els = root.querySelectorAll<HTMLElement>(".s-card__subtitle, .s-item__subtitle");
	let first: string | null = null;
	for (const el of Array.from(els)) {
		const text = el.textContent?.trim();
		if (!text) continue;
		if (first == null) first = text;
		if (splitSubtitle(text).conditionId) return text;
	}
	return first;
}

/**
 * eBay's title text node is contaminated by a "New Listing" badge prefix and a
 * screen-reader-only "Opens in a new window or tab" suffix. Strip both so the
 * caller sees the clean listing title.
 */
function cleanTitle(text: string | null): string {
	if (!text) return "";
	return text
		.replace(/^new listing/i, "")
		.replace(/opens in a new window or tab\.?$/i, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Walk every `.s-card__attribute-row` and `.s-card__footer*` plain-text node and
 * pattern-match into named fields. Modern eBay packs these signals as free text
 * (no class name per signal), so we read each row and route it.
 */
function classifyAttributeRows(card: Element): {
	shippingText: string | null;
	buyingFormatText: string | null;
	watchCountText: string | null;
	bidCountText: string | null;
	timeLeftText: string | null;
	soldDateText: string | null;
	sellerFeedbackText: string | null;
	soldQuantityText: string | null;
} {
	const rows = Array.from(card.querySelectorAll(".s-card__attribute-row, .s-card__footer, .s-card__footer--row"));
	let shipping: string | null = null;
	let buyingFormat: string | null = null;
	let watchers: string | null = null;
	let bids: string | null = null;
	let timeLeft: string | null = null;
	let soldDate: string | null = null;
	let seller: string | null = null;
	let soldQty: string | null = null;

	for (const row of rows) {
		const text = row.textContent?.trim() ?? "";
		if (!text) continue;

		if (!watchers && /\d+\s*(watchers?|watching)/i.test(text)) watchers = text;
		else if (
			!shipping &&
			/(free\s+(delivery|shipping)|\+?\$[0-9.]+\s*(delivery|shipping)|\+?\$[0-9.]+\s*postage)/i.test(text)
		)
			shipping = text;
		else if (!buyingFormat && /(or best offer|buy it now|auction)/i.test(text)) buyingFormat = text;
		else if (!bids && /\d+\s*bids?/i.test(text)) bids = text;
		else if (!timeLeft && /(\d+d\s*\d+h|\d+h\s*\d+m|\d+m\s*\d+s|ends in|left|days? left)/i.test(text))
			timeLeft = text;
		else if (!soldDate && /^sold\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text))
			// Match "Sold Mar 30, 2026" — date-style sold lines, not "5 sold" quantity.
			soldDate = text;
		else if (!soldDate && /verkauft am|completed/i.test(text)) soldDate = text;
		else if (!soldQty && /^\d+\s+sold\b/i.test(text))
			// "5 sold", "5 sold of 10", "9 sold this week" — active-side popularity.
			soldQty = text;
		else if (!seller && /\d+(\.\d+)?%\s*positive/i.test(text)) seller = text;
	}
	return {
		shippingText: shipping,
		buyingFormatText: buyingFormat,
		watchCountText: watchers,
		bidCountText: bids,
		timeLeftText: timeLeft,
		soldDateText: soldDate,
		sellerFeedbackText: seller,
		soldQuantityText: soldQty,
	};
}

/**
 * Extract the page-header total result count (e.g., "9,234 results"). eBay's
 * search response page caps our visible items at ~240 across pagination, but
 * the header still shows the true population total. We use that for arrival-rate
 * estimates so they aren't biased low by the scrape window.
 */
export function parseResultCount(root: ParentNode): number | null {
	const candidates = [".srp-controls__count-heading", ".srp-controls__count", "h1.srp-controls__count-heading"];
	for (const sel of candidates) {
		const el = root.querySelector(sel);
		const t = el?.textContent ?? "";
		const m = t.match(/([\d,]+)/);
		if (m) {
			const n = Number.parseInt((m[1] ?? "0").replace(/,/g, ""), 10);
			if (Number.isFinite(n) && n > 0) return n;
		}
	}
	// Fallback: scan all <h1>/<h2> for "X results"
	const heads = root.querySelectorAll("h1,h2,span");
	for (const h of Array.from(heads).slice(0, 30)) {
		const t = h.textContent ?? "";
		const m = t.match(/([\d,]+)\s*(?:results?|matches)/i);
		if (m) {
			const n = Number.parseInt((m[1] ?? "0").replace(/,/g, ""), 10);
			if (Number.isFinite(n) && n > 0) return n;
		}
	}
	return null;
}

export function extractEbayItems(root: ParentNode): RawEbayItem[] {
	// Modern eBay (2025+) renders results as <li class="s-card ..."> inside
	// <ul class="srp-results srp-list">. Legacy <li class="s-item"> stays in
	// the union for backward-compat with cached fixtures.
	const items = root.querySelectorAll<HTMLElement>("li.s-card, li.s-item");
	const out: RawEbayItem[] = [];
	for (const li of Array.from(items)) {
		// Skip "Shop on eBay" filler cards eBay injects at the top of search.
		const titleText = cleanTitle(firstText(li, [".s-card__title", ".s-item__title"]));
		if (!titleText || /^shop on ebay$/i.test(titleText)) continue;

		const link = li.querySelector<HTMLAnchorElement>(".s-card__link, .s-item__link");
		const url = link?.getAttribute("href") ?? "";
		if (!url) continue;

		// Modern: data-listingid attribute holds a clean numeric id.
		const dataId = li.getAttribute("data-listingid");
		const itemId = dataId && /^\d{9,}$/.test(dataId) ? dataId : extractItemIdFromUrl(url);

		const priceText = firstText(li, [".s-card__price", ".s-item__price"]);
		const subtitleText = pickConditionSubtitle(li);
		const captionText = firstText(li, [".s-card__caption", ".s-item__caption .s-item__caption--signal"]);

		const classified = classifyAttributeRows(li);
		const imageEl = li.querySelector<HTMLImageElement>(".s-card__image, .s-item__image-img");
		const imageUrl =
			imageEl?.getAttribute("src") ??
			imageEl?.getAttribute("data-src") ??
			imageEl?.getAttribute("data-defer-load") ??
			null;

		out.push({
			title: titleText,
			priceText,
			shippingText: classified.shippingText ?? firstText(li, [".s-item__shipping"]),
			subtitleText,
			url,
			soldDate:
				classified.soldDateText ??
				(captionText && /^sold|verkauft|completed/i.test(captionText) ? captionText : null),
			itemIdHint: itemId,
			bidCountText: classified.bidCountText ?? firstText(li, [".s-item__bids", ".s-item__bidCount"]),
			timeLeftText: classified.timeLeftText ?? firstText(li, [".s-item__time-left", ".s-item__time-end"]),
			buyingFormat:
				classified.buyingFormatText ?? firstText(li, [".s-item__purchase-options", ".s-item__formatBuyItNow"]),
			watchCountText: classified.watchCountText,
			sellerFeedbackText:
				classified.sellerFeedbackText ?? firstText(li, [".s-item__seller-info-text", ".s-item__etrs-text"]),
			imageUrl: imageUrl && !/blank|placeholder|fxxj3ttftm5ltcqnto1o4baovyl/.test(imageUrl) ? imageUrl : null,
			soldQuantityText: classified.soldQuantityText,
			topRatedBuyingExperience: hasTopRatedPlus(li),
		});
	}
	return out;
}

export interface RawEbayDetail {
	itemId: string | null;
	title: string;
	priceText: string | null;
	conditionText: string | null;
	shippingText: string | null;
	categoryPath: string[];
	/** Numeric category IDs from breadcrumb hrefs, parallel to `categoryPath`. */
	categoryIds: string[];
	/** True when the page carries a Top Rated Plus badge. */
	topRatedBuyingExperience: boolean;
	seller: {
		name: string | null;
		feedbackScoreText: string | null;
		feedbackPercentText: string | null;
	};
	bidCountText: string | null;
	timeLeftText: string | null;
	watchCountText: string | null;
	description: string | null;
	imageUrls: string[];
	/**
	 * Item-specifics rows from the eBay detail page's "Item specifics"
	 * section. Each entry is a `{ name, value }` pair — Browse REST
	 * `getItem` exposes the same data as `localizedAspects`. We keep
	 * only the visible text; eBay's `Read more`/`See definitions` UI
	 * controls are stripped at parse time.
	 */
	aspects: Array<{ name: string; value: string }>;
	/** ISO 8601 listing creation timestamp from embedded SEMANTIC_DATA. */
	itemCreationDate: string | null;
	/** ISO 8601 listing end timestamp from embedded SEMANTIC_DATA. */
	itemEndDate: string | null;
	/** "ACTIVE" | "ENDED" | "COMPLETED" — listing lifecycle state from SEMANTIC_DATA. */
	listingStatus: string | null;
	/** "EBAY_US" | "EBAY_DE" | … — listing's home marketplace from SEMANTIC_DATA. */
	marketplaceListedOn: string | null;
	/** True iff `singleSkuOutOfStock` is set — sold (or otherwise depleted). */
	soldOut: boolean | null;
	/** Display string e.g. "Tulsa, Oklahoma, United States". Best-effort regex extraction. */
	itemLocationText: string | null;
}

/**
 * Bracket-balanced extractor for the SEMANTIC_DATA JSON block embedded in
 * eBay's modern listing detail pages. eBay bootstraps page state via inline
 * `<script>` tags containing `"SEMANTIC_DATA":{...}` — we walk balanced
 * braces (string-aware) and JSON.parse the slice. Returns null when not
 * found or parse fails.
 */
function extractSemanticData(root: ParentNode): Record<string, unknown> | null {
	const scripts = root.querySelectorAll("script");
	for (const script of Array.from(scripts)) {
		const text = script.textContent ?? "";
		const key = '"SEMANTIC_DATA":';
		const keyIdx = text.indexOf(key);
		if (keyIdx === -1) continue;
		const objStart = text.indexOf("{", keyIdx + key.length);
		if (objStart === -1) continue;
		let depth = 0;
		let inString = false;
		let escape = false;
		let objEnd = -1;
		for (let i = objStart; i < text.length; i++) {
			const c = text[i];
			if (escape) {
				escape = false;
				continue;
			}
			if (c === "\\") {
				escape = true;
				continue;
			}
			if (c === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (c === "{") depth++;
			else if (c === "}") {
				depth--;
				if (depth === 0) {
					objEnd = i + 1;
					break;
				}
			}
		}
		if (objEnd === -1) continue;
		try {
			return JSON.parse(text.slice(objStart, objEnd));
		} catch {}
	}
	return null;
}

function getString(obj: Record<string, unknown> | null, key: string): string | null {
	if (!obj) return null;
	const v = obj[key];
	return typeof v === "string" ? v : null;
}

function getWrappedDate(obj: Record<string, unknown> | null, key: string): string | null {
	if (!obj) return null;
	const wrapped = obj[key];
	if (wrapped && typeof wrapped === "object" && "value" in wrapped) {
		const v = (wrapped as { value?: unknown }).value;
		return typeof v === "string" ? v : null;
	}
	return null;
}

/**
 * Best-effort extraction of the location display string ("City, State, Country")
 * from eBay's `itemLocation` LabelsValues block. Pattern-matches the textSpan
 * inside `values` — robust to whitespace + arbitrary intermediate fields.
 */
function extractLocationText(html: string): string | null {
	const re = /"itemLocation"\s*:\s*\{[\s\S]{0,400}?"values"\s*:\s*\[[\s\S]{0,400}?"text"\s*:\s*"([^"]+)"/;
	const m = html.match(re);
	return m ? (m[1] ?? null) : null;
}

function txt(root: ParentNode, sel: string): string | null {
	return root.querySelector(sel)?.textContent?.trim() ?? null;
}

const DETAIL_SELECTORS = {
	title: ["#itemTitle", ".x-item-title__mainTitle", ".x-item-title span"],
	price: ["#prcIsum", "#mm-saleDscPrc", ".x-price-primary span", ".ux-price-secondary"],
	// 2026 layout: condition + brand + a few other top-fold facts live in
	// `.elevated-info__item` rows (label/value pair). Older fixtures kept
	// as fallbacks below — the page hasn't shipped both at once but a
	// rollback is cheap to absorb.
	condition: [
		".x-item-condition-text .ux-textspans:not(.clipped)",
		".x-item-condition-text span",
		".x-item-condition-value",
		"#vi-itm-cond",
	],
	shipping: ["#fshippingCost", ".ux-labels-values--shipping .ux-labels-values__values"],
	timeLeft: ["#vi-cdown_timeLeft", ".x-time-left__time-left-text", ".vi-evo-main-tm"],
	bidCount: ["#qty-test", ".x-bid-count", "#qtySubTxt"],
	watchCount: [".vi-buybox-watchcount", ".x-msku__select-box", "#w1-3-_msg"],
	// 2025+ "x-sellercard-atf" layout. Legacy "ux-seller-section" kept for fixtures.
	sellerName: [
		".x-sellercard-atf__info__about-seller .ux-textspans--BOLD",
		".ux-seller-section__item--seller a",
		"#RightSummaryPanel .mbg-nw",
	],
	sellerFeedback: [
		".x-sellercard-atf__about-seller-item .ux-textspans--SECONDARY",
		".ux-seller-section__item--seller .ux-textspans--PSEUDOLINK",
		"#si-fb",
	],
	sellerPercent: [
		".x-sellercard-atf .ux-textspans--POSITIVE",
		".x-sellercard-atf",
		".ux-seller-section__item--seller + .ux-seller-section__content",
	],
	description: ["#viTabs_0_is", ".x-item-description", ".item-description"],
	images: [".ux-image-carousel-item img", "#icImg", ".ux-image-magnify__image img"],
};

function firstMatchText(root: ParentNode, selectors: string[]): string | null {
	for (const sel of selectors) {
		const value = txt(root, sel);
		if (value) return value;
	}
	return null;
}

/**
 * Walk the modern `.elevated-info__item` rows at the top of the detail
 * page (label / value pairs that fold the most-asked facts above the
 * description) and return the value of the row whose label is exactly
 * `Condition`. eBay copies the value into the `aria-label` of an
 * "About this item condition" tooltip button as well; we read the
 * button's visible text instead so the result is a clean phrase like
 * `"New with box and papers"`.
 */
function extractCondition(root: ParentNode): string | null {
	const items = root.querySelectorAll<HTMLElement>(".elevated-info__item");
	for (const item of Array.from(items)) {
		const label = item.querySelector(".elevated-info__item__label")?.textContent?.trim();
		if (!label || !/^condition$/i.test(label)) continue;
		const valueEl = item.querySelector(".elevated-info__item__value");
		if (!valueEl) continue;
		// `.textContent` walks into the tooltip button and yields just
		// the visible label — no need to special-case the button.
		const text = valueEl.textContent?.replace(/\s+/g, " ").trim();
		if (text) return text;
	}
	return null;
}

/**
 * Walk the SEO breadcrumb anchors and return the category hierarchy as
 * an ordered list. eBay collapses long hierarchies behind a `…` overflow
 * menu whose items also use the `.seo-breadcrumb-text` class — we pick
 * up both the visible chevroned anchors AND the menu items, dedupe by
 * text, and skip the screen-reader-only `breadcrumb` heading. Old
 * `<li>`-textContent based reads were grabbing the SVG separators and
 * concatenated parent labels; reading the anchor text directly is
 * deterministic.
 */
// Pull the numeric category id from an eBay breadcrumb href.
// eBay's category pages live at `/b/<slug>/<id>/...`, e.g.
// `https://www.ebay.com/b/Wristwatches/31387/bn_2408451`.
function categoryIdFromHref(href: string | null | undefined): string | null {
	if (!href) return null;
	const m = href.match(/\/b\/[^/]+\/(\d{2,})(?:\/|\?|$)/);
	return m ? (m[1] ?? null) : null;
}

function extractBreadcrumb(root: ParentNode): { names: string[]; ids: string[] } {
	const seen = new Set<string>();
	const names: string[] = [];
	const ids: string[] = [];
	const push = (text: string | null | undefined, href: string | null | undefined) => {
		if (!text) return;
		const cleaned = text.replace(/\s+/g, " ").trim();
		if (!cleaned || /^breadcrumb$/i.test(cleaned)) return;
		// "See more <SKU title>" — eBay tacks a related-search anchor
		// onto the end of the breadcrumb that re-uses the same class
		// names. It always starts with "See more" and is not a category.
		if (/^see more\b/i.test(cleaned)) return;
		if (seen.has(cleaned)) return;
		seen.add(cleaned);
		names.push(cleaned);
		const id = categoryIdFromHref(href);
		if (id) ids.push(id);
	};
	// Modern: anchors live inside `nav.breadcrumbs`. Scope the
	// querySelectorAll to that nav so we don't pick up unrelated
	// `.seo-breadcrumb-text` links elsewhere on the page (e.g. the
	// "See more like this" related-search anchor that uses the same
	// class). Both the visible chevroned anchors and the items inside
	// the `…` overflow menu live inside the nav, so they're still hit.
	const nav = root.querySelector("nav.breadcrumbs, #vi-VR-brumb-lnkLst");
	if (nav) {
		const anchors = nav.querySelectorAll<HTMLAnchorElement>("a.seo-breadcrumb-text");
		for (const a of Array.from(anchors)) {
			const span = a.querySelector("span");
			push((span ?? a).textContent, a.getAttribute("href"));
		}
		if (names.length === 0) {
			// Fallback for older / fixture layouts: plain `<li>` children
			// whose text is the bare category name (no href → no id).
			const lis = nav.querySelectorAll<HTMLElement>("li");
			for (const li of Array.from(lis)) push(li.textContent, null);
		}
	}
	return { names, ids };
}

// Detect eBay's Top Rated Plus badge. The badge surfaces three different
// ways depending on context: a `<use href="#icon-top-rated-plus-...">`
// SVG ref on the detail page's trust panel, an `aria-label="Top Rated
// Plus"` on the search-result card icon, and a legacy
// `.su-icon--legacy-top-rated-seller` class. Any of them = present.
function hasTopRatedPlus(root: ParentNode | Element): boolean {
	return Boolean(
		(root as Element).querySelector?.(
			'use[href*="top-rated-plus"], [aria-label="Top Rated Plus"], .su-icon--legacy-top-rated-seller',
		),
	);
}

/**
 * Pull the `<dl data-testid="ux-labels-values">` rows from the eBay
 * detail page's "Item specifics" section. Each `<dl>` is one row:
 * `<dt>` carries the aspect name, `<dd>` carries the value. We
 * collapse the visible text and strip eBay's UI controls
 * (`Read more`, `See all condition definitions`, `View item description
 * for full details`) which sit inside the same nodes.
 *
 * Skips the `Condition` row — that's already surfaced separately as
 * `conditionText` and Browse REST treats it as its own field, not
 * an aspect.
 */
function extractItemAspects(root: ParentNode): Array<{ name: string; value: string }> {
	const out: Array<{ name: string; value: string }> = [];
	const seen = new Set<string>();
	const dls = root.querySelectorAll<HTMLElement>('dl[data-testid="ux-labels-values"], dl.ux-labels-values');
	for (const dl of Array.from(dls)) {
		const labelEl = dl.querySelector(".ux-labels-values__labels");
		const valueEl = dl.querySelector(".ux-labels-values__values");
		if (!labelEl || !valueEl) continue;
		const name = aspectText(labelEl);
		if (!name) continue;
		// Browse REST exposes `condition` as its own field, not under
		// localizedAspects — skip the row that re-states it.
		if (/^condition$/i.test(name)) continue;
		const value = aspectText(valueEl);
		if (!value) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name, value });
	}
	return out;
}

/**
 * Read the user-visible text of an aspect label or value. eBay packs a
 * truncated "ends with …" version + a hidden full-text copy into the
 * same `<dd>` for long fields (e.g. condition descriptions, item
 * descriptions). When the hidden full version is present we use that
 * and ignore the truncated copy; otherwise we fall back to every
 * `.ux-textspans` child. UI controls (`Read more`, `See all condition
 * definitions`, accessibility-clipped spans) are stripped in both
 * cases so the caller sees a clean value.
 */
function aspectText(el: Element): string {
	// Hidden full-text container, marked by aria-hidden=true. Present
	// when eBay rendered a "Read more" toggle.
	const hiddenFull = el.querySelector<HTMLElement>(
		'[data-testid="ux-expandable-textual-display-block-inline"][aria-hidden="true"]',
	);
	const scope: Element = hiddenFull ?? el;
	const spans = scope.querySelectorAll<HTMLElement>(".ux-textspans");
	const parts: string[] = [];
	for (const span of Array.from(spans)) {
		if (span.classList.contains("clipped")) continue;
		if (span.closest(".ux-action, button, [data-testid='ux-action']")) continue;
		// Skip the truncated visible copy when we're not in the hidden one.
		// The truncated copy lives inside an .ux-expandable-textual-display-block-inline
		// that does NOT have aria-hidden — so when scope = el (no hidden full),
		// we may still hit it; that's the correct fallback. When scope =
		// hiddenFull, the truncated sibling is outside scope and skipped.
		const text = span.textContent?.trim();
		if (text) parts.push(text);
	}
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function extractEbayDetail(root: ParentNode, sourceUrl: string, html?: string): RawEbayDetail {
	const breadcrumb = extractBreadcrumb(root);

	const imageNodes = Array.from(root.querySelectorAll<HTMLImageElement>(DETAIL_SELECTORS.images.join(", ")));
	const seen = new Set<string>();
	const imageUrls: string[] = [];
	for (const img of imageNodes) {
		const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
		if (src && !seen.has(src)) {
			seen.add(src);
			imageUrls.push(src);
		}
	}

	const semantic = extractSemanticData(root);
	const itemLocationText = html ? extractLocationText(html) : null;
	const soldOutValue = semantic?.singleSkuOutOfStock;
	const aspects = extractItemAspects(root);

	return {
		itemId: extractItemIdFromUrl(sourceUrl),
		title: firstMatchText(root, DETAIL_SELECTORS.title) ?? "",
		priceText: firstMatchText(root, DETAIL_SELECTORS.price),
		conditionText: extractCondition(root) ?? firstMatchText(root, DETAIL_SELECTORS.condition),
		shippingText: firstMatchText(root, DETAIL_SELECTORS.shipping),
		categoryPath: breadcrumb.names,
		categoryIds: breadcrumb.ids,
		topRatedBuyingExperience: hasTopRatedPlus(root),
		seller: {
			name: firstMatchText(root, DETAIL_SELECTORS.sellerName) ?? getString(semantic, "sellerUserName"),
			feedbackScoreText: firstMatchText(root, DETAIL_SELECTORS.sellerFeedback),
			feedbackPercentText: firstMatchText(root, DETAIL_SELECTORS.sellerPercent),
		},
		bidCountText: firstMatchText(root, DETAIL_SELECTORS.bidCount),
		timeLeftText: firstMatchText(root, DETAIL_SELECTORS.timeLeft),
		watchCountText: firstMatchText(root, DETAIL_SELECTORS.watchCount),
		description: firstMatchText(root, DETAIL_SELECTORS.description),
		imageUrls,
		aspects,
		itemCreationDate: getWrappedDate(semantic, "startDate"),
		itemEndDate: getWrappedDate(semantic, "endDate"),
		listingStatus: getString(semantic, "listingStatus"),
		marketplaceListedOn: getString(semantic, "marketplaceListedOn"),
		soldOut: typeof soldOutValue === "boolean" ? soldOutValue : null,
		itemLocationText,
	};
}

export function parseEbayPrice(text: string | null): { cents: number | null; currency: string } {
	if (!text) return { cents: null, currency: "USD" };
	const match = text.match(/([a-zA-Z€$£]+)?\s*([\d.,]+)/);
	if (!match) return { cents: null, currency: "USD" };
	const currencySymbol = match[1]?.trim() ?? "";
	const numberRaw = match[2] ?? "";
	const hasCommaDecimal = /,[0-9]{2}$/.test(numberRaw);
	const normalized = hasCommaDecimal ? numberRaw.replace(/\./g, "").replace(",", ".") : numberRaw.replace(/,/g, "");
	const num = Number.parseFloat(normalized);
	if (Number.isNaN(num)) return { cents: null, currency: "USD" };
	const currency =
		currencySymbol === "$" || /usd/i.test(currencySymbol)
			? "USD"
			: currencySymbol === "€" || /eur/i.test(currencySymbol)
				? "EUR"
				: currencySymbol === "£" || /gbp/i.test(currencySymbol)
					? "GBP"
					: "USD";
	return { cents: Math.round(num * 100), currency };
}

export function parseEbayShipping(text: string | null): number | null {
	if (!text) return null;
	if (/kostenlos|free/i.test(text)) return 0;
	const price = parseEbayPrice(text);
	return price.cents;
}

export function parseBidCount(text: string | null): number | null {
	if (!text) return null;
	const match = text.match(/(\d+)/);
	return match ? Number.parseInt(match[1] ?? "0", 10) : null;
}

export function parseFeedbackScore(text: string | null): number | null {
	if (!text) return null;
	// Modern: "robertscamera 99.7% positive (280.1K)" — feedback score is in the
	// trailing parenthetical (count of feedbacks). 280.1K → 280100.
	const paren = text.match(/\(([\d.]+)\s*([KkMm]?)\)/);
	if (paren) {
		const n = Number.parseFloat(paren[1] ?? "0");
		const mult = paren[2]?.toLowerCase() === "k" ? 1000 : paren[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
		return Number.isFinite(n) ? Math.round(n * mult) : null;
	}
	const match = text.match(/(\d[\d.,]*)/);
	if (!match) return null;
	return Number.parseInt((match[1] ?? "0").replace(/[.,]/g, ""), 10);
}

/**
 * Parse the seller-info text the modern card footer renders:
 * `"ron_storm 100% positive (1.5K)"` → `{ username, feedbackPercentage,
 * feedbackScore }`. Marketplace Insights returns `feedbackPercentage`
 * as a string ("99.5") so we mirror that. Returns nulls for any field
 * the input doesn't carry.
 */
export function parseSellerInfo(text: string | null): {
	username: string | null;
	feedbackPercentage: string | null;
	feedbackScore: number | null;
} {
	if (!text) return { username: null, feedbackPercentage: null, feedbackScore: null };
	// Username = leading non-space token, before the percentage.
	const usernameMatch = text.match(/^([A-Za-z0-9._-]+)\s+/);
	const pctMatch = text.match(/([\d.]+)\s*%/);
	return {
		username: usernameMatch ? (usernameMatch[1] ?? null) : null,
		feedbackPercentage: pctMatch ? (pctMatch[1] ?? null) : null,
		feedbackScore: parseFeedbackScore(text),
	};
}

export function parseWatchCount(text: string | null): number | null {
	if (!text) return null;
	const match = text.match(/(\d+)\s*(Beobachter|watchers?|watching)/i);
	if (match) return Number.parseInt(match[1] ?? "0", 10);
	const any = text.match(/(\d+)/);
	return any ? Number.parseInt(any[1] ?? "0", 10) : null;
}

export function endDateFromTimeLeft(text: string | null, nowMs = Date.now()): string | null {
	if (!text) return null;
	if (/ended|sold|complete/i.test(text)) return null;
	let total = 0;
	const re = /(\d+)\s*(d|h|m|s|day|hour|min|sec)/gi;
	let m: RegExpExecArray | null = re.exec(text);
	while (m !== null) {
		const n = Number.parseInt(m[1] ?? "0", 10);
		const unit = (m[2] ?? "").toLowerCase().slice(0, 1);
		if (unit === "d") total += n * 86_400_000;
		else if (unit === "h") total += n * 3_600_000;
		else if (unit === "m") total += n * 60_000;
		else if (unit === "s") total += n * 1000;
		m = re.exec(text);
	}
	return total > 0 ? new Date(nowMs + total).toISOString() : null;
}

export function timeLeftFromEndDate(iso: string | null, nowMs = Date.now()): string | null {
	if (!iso) return null;
	const ms = Date.parse(iso) - nowMs;
	if (!Number.isFinite(ms) || ms <= 0) return null;
	const d = Math.floor(ms / 86_400_000);
	const h = Math.floor((ms % 86_400_000) / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function normalizeBuyingFormat(text: string | string[] | null | undefined): "AUCTION" | "FIXED_PRICE" | null {
	if (text == null) return null;
	const joined = Array.isArray(text) ? text.join(" ") : text;
	if (/auction|gebot|bid/i.test(joined)) return "AUCTION";
	if (/buy.?it.?now|sofort.?kauf|fixed|best offer/i.test(joined)) return "FIXED_PRICE";
	return null;
}

/**
 * eBay's canonical condition labels and their numeric `conditionId` enums.
 * Source: eBay Marketplace Insights `condition` enum + Browse `conditionIds`
 * filter values. The display label is what shows up in `s-card__subtitle`
 * (e.g. `"Brand New"`, `"Pre-Owned"`); the id is what callers can pass
 * back into `/v1/listings/search?filter=conditionIds:{1000}`.
 *
 * Ordered most-specific first so partial matches (e.g. "New (Other)")
 * don't get swallowed by "New".
 */
const CANONICAL_CONDITIONS: ReadonlyArray<{ label: string; id: string }> = [
	{ label: "Certified - Refurbished", id: "2010" },
	{ label: "Excellent - Refurbished", id: "2020" },
	{ label: "Very Good - Refurbished", id: "2030" },
	{ label: "Good - Refurbished", id: "2040" },
	{ label: "Manufacturer refurbished", id: "2000" },
	{ label: "Seller refurbished", id: "2500" },
	{ label: "New with defects", id: "1750" },
	{ label: "New with tags", id: "1000" },
	{ label: "New without tags", id: "1500" },
	{ label: "New without box", id: "1500" },
	{ label: "New (Other)", id: "1500" },
	{ label: "Open box", id: "1500" },
	{ label: "Like New", id: "2750" },
	{ label: "Brand New", id: "1000" },
	{ label: "Pre-Owned", id: "3000" },
	{ label: "For parts or not working", id: "7000" },
	{ label: "Very Good", id: "4000" },
	{ label: "Acceptable", id: "6000" },
	{ label: "Used", id: "3000" },
	{ label: "New", id: "1000" },
	{ label: "Good", id: "5000" },
];

/**
 * Split eBay's compound subtitle text — `"Brand New · Gucci G-Timeless ·
 * Stainless Steel"` — into a canonical condition label + remaining
 * item-specific attributes. When the first segment matches a canonical
 * label, returns it as `condition` + maps to `conditionId`. When it
 * doesn't (seller-custom strings like `"100% New, Authentic Product
 * from Direct Luxury"`), passes the entire string through as `condition`
 * with no `conditionId` and no attributes.
 */
export function splitSubtitle(text: string | null): {
	condition: string | null;
	conditionId: string | null;
	itemAttributes: string[];
} {
	if (!text) return { condition: null, conditionId: null, itemAttributes: [] };
	const segments = text
		.split(/\s+·\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const head = segments[0] ?? "";
	const matched = CANONICAL_CONDITIONS.find((c) => c.label.toLowerCase() === head.toLowerCase());
	if (matched) {
		return {
			condition: matched.label,
			conditionId: matched.id,
			itemAttributes: segments.slice(1),
		};
	}
	// Seller-custom condition string. Keep raw, no id, no attrs.
	return { condition: text.trim(), conditionId: null, itemAttributes: [] };
}

/**
 * Parse "5 sold", "5 sold of 10", "9 sold this week" into an integer.
 * Used for active listings to surface popularity (Marketplace Insights
 * exposes this as `totalSoldQuantity`).
 */
export function parseSoldQuantity(text: string | null): number | null {
	if (!text) return null;
	const match = text.match(/^(\d+)\s+sold/i);
	if (!match) return null;
	return Number.parseInt(match[1] ?? "0", 10);
}

/**
 * Map a free-form condition text — e.g. detail-page phrasing like
 * `"New with box and papers"`, `"Brand New"`, or
 * `"Pre-Owned: An item that has been used previously."` — to the
 * canonical Browse / Insights `conditionId`. Returns `null` when no
 * canonical label matches as a substring.
 *
 * Detail pages often add seller clarifications after the canonical
 * label ("New with box and papers"); search subtitles use the bare
 * label. A simple substring scan over `CANONICAL_CONDITIONS` covers
 * both cases without per-locale parsing.
 */
export function resolveConditionId(text: string | null | undefined): string | null {
	if (!text) return null;
	const lower = text.toLowerCase();
	for (const c of CANONICAL_CONDITIONS) {
		if (lower.includes(c.label.toLowerCase())) return c.id;
	}
	// `"New with box and papers"`, `"New in box"`, `"New, never worn"`,
	// etc. — any bare "new ..." phrase that didn't match a more specific
	// canonical label maps to the base "New" id (1000).
	if (/^new\b/i.test(text)) return "1000";
	return null;
}
