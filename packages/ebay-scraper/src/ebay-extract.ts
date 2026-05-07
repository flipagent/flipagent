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
	/**
	 * True when the card carries the Authenticity Guarantee badge — eBay
	 * routes these listings through a third-party authenticator before
	 * delivery. Watches >$250, sneakers >$100, handbags, fine jewelry, and
	 * recently trading cards. eBay's modern `.s-card` SRP layout swaps the
	 * seller-feedback line for the AG badge entirely, so without this flag
	 * downstream scoring (`legitMarketReference`, `assessRisk`) reads AG
	 * comps as anonymous-zero-trust and over-flags them as fraud.
	 */
	authenticityGuaranteed: boolean;
	/**
	 * eBay product identifier — present when the card links to a catalog
	 * product page (`/p/{epid}`). Roughly 30–40% of cards on a typical
	 * search are catalog-linked. Used by composite endpoints to group
	 * candidates by product without an LLM call.
	 */
	epid: string | null;
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

	// Each row may pack multiple signals at once (eBay's modern SRP often
	// renders "0 bids · Time left 2h 57m left  (Mon, 02:35 PM)" as one
	// row). Run every pattern independently per row instead of an
	// `else if` chain — the chain would let the first match consume the
	// row and silently swallow downstream signals (cost us auction
	// `timeLeft` until 2026-05).
	for (const row of rows) {
		const text = row.textContent?.trim() ?? "";
		if (!text) continue;

		if (!watchers && /\d+\s*(watchers?|watching)/i.test(text)) watchers = text;
		if (
			!shipping &&
			/(free\s+(delivery|shipping)|\+?\$[0-9.]+\s*(delivery|shipping)|\+?\$[0-9.]+\s*postage)/i.test(text)
		)
			shipping = text;
		if (!buyingFormat && /(or best offer|buy it now|auction)/i.test(text)) buyingFormat = text;
		if (!bids && /\d+\s*bids?/i.test(text)) bids = text;
		if (!timeLeft && /(\d+d\s*\d+h|\d+h\s*\d+m|\d+m\s*\d+s|ends in|left|days? left)/i.test(text)) timeLeft = text;
		if (!soldDate && /^sold\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text))
			// Match "Sold Mar 30, 2026" — date-style sold lines, not "5 sold" quantity.
			soldDate = text;
		if (!soldDate && /verkauft am|completed/i.test(text)) soldDate = text;
		if (!soldQty && /^\d+\s+sold\b/i.test(text))
			// "5 sold", "5 sold of 10", "9 sold this week" — active-side popularity.
			soldQty = text;
		if (!seller && /\d+(\.\d+)?%\s*positive/i.test(text)) seller = text;
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

		// eBay links the card to its catalog product page via /p/{epid}
		// when the listing is catalog-linked, OR encodes the epid as a
		// URL parameter on the listing's own /itm/ link (`?...&epid=NNN`).
		// The second form covers more cards: `/p/` only renders when there's
		// a separate "View product page" link, but `?epid=` shows up on any
		// card the seller bound to a catalog product. Try both — first
		// match wins, /p/ takes precedence since it's the primary signal.
		const liHtml = li.outerHTML;
		const epidPathMatch = liHtml.match(/\/p\/(\d{6,})/);
		const epidParamMatch = epidPathMatch ? null : liHtml.match(/[?&]epid=(\d{6,})/);
		const epid = epidPathMatch?.[1] ?? epidParamMatch?.[1] ?? null;

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
			authenticityGuaranteed: hasAuthenticityGuarantee(li),
			epid,
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
	/**
	 * True iff the listing accepts Best Offer alongside its BIN price.
	 * Detected from the "or Best Offer" SECONDARY textspan eBay renders
	 * next to the price block when offers are enabled.
	 */
	bestOfferEnabled: boolean;
	/**
	 * Returns policy in eBay REST `returnTerms` shape — parsed from the
	 * schema.org `hasMerchantReturnPolicy` JSON-LD block embedded in the
	 * detail page. Emitted in the eBay-REST shape (not schema.org's) so
	 * downstream code reads scrape and REST through one extractor. Null
	 * when the block is absent or the policy category is unrecognised.
	 */
	returnTerms: EbayReturnTerms | null;
	/**
	 * Multi-SKU variations parsed from the page's `MSKU` model. Null when
	 * the listing isn't multi-variation. Each entry has its own price and
	 * the per-axis aspects (Size, Color, …) — letting callers pick the
	 * right SKU's signal instead of reading the page's default-rendered
	 * top-of-fold price + generic aspects.
	 */
	variations: EbayVariation[] | null;
	/**
	 * The variation id eBay rendered the page for. Driven by the URL's
	 * `?var=<id>` if present, or eBay's server-side default pick when
	 * absent. Lets callers correlate the rendered top-of-page price /
	 * aspects with one entry in `variations`.
	 */
	selectedVariationId: string | null;
	/**
	 * Authenticity Guarantee block when the listing qualifies for eBay's
	 * authenticator program (sneakers / handbags / watches / trading cards
	 * / fine jewelry). Null on non-AG listings. Mirror of Browse REST
	 * `getItem.authenticityGuarantee` — same field shape so callers read
	 * scrape + REST through one extractor.
	 *
	 * `description` is the visible PDP text ("This item is shipped to an
	 * eBay authenticator before delivery."). `termsWebUrl` stays absent
	 * from scrape — eBay doesn't expose a stable terms link in the PDP
	 * markup; REST is the only source for it.
	 */
	authenticityGuarantee: { description?: string } | null;
	/**
	 * Short description from the listing's `<meta name="description">` tag
	 * — eBay populates it from the seller's first paragraph. Mirror of
	 * Browse REST `getItem.shortDescription`.
	 */
	shortDescription: string | null;
	/**
	 * Distinct payment brand names visible in the PDP's payments section
	 * — `PAYPAL`, `VISA`, `MASTERCARD`, `DISCOVER`, `AMERICAN_EXPRESS`,
	 * `APPLE_PAY`, `GOOGLE_PAY`, `DINERS_CLUB`, `PAYPAL_CREDIT`. The
	 * transform layer buckets these into REST's
	 * `paymentMethods[]` shape (`WALLET` / `CREDIT_CARD` / `OTHER`).
	 */
	paymentBrands: string[];
	/**
	 * Cross-border shipping eligibility — `regionIncluded` is the
	 * countries/regions the seller will ship to; `regionExcluded` overrides
	 * specific countries inside an included region. Mirror of Browse REST
	 * `getItem.shipToLocations`. We populate `regionName` from the visible
	 * comma list; `regionId` / `regionType` stay absent because the PDP
	 * doesn't expose ISO codes (REST is the source of truth for those).
	 */
	shipToLocations: {
		regionIncluded: Array<{ regionName: string }>;
		regionExcluded: Array<{ regionName: string }>;
	} | null;
	/**
	 * `immediatePay` from the embedded `SEMANTIC_DATA` JSON block — eBay's
	 * "buyer must pay immediately on Buy It Now" flag. Null when the page
	 * doesn't carry the SEMANTIC_DATA block (older layouts).
	 */
	immediatePay: boolean | null;
	/**
	 * `guestCheckout` from `SEMANTIC_DATA` — eBay's
	 * `enabledForGuestCheckout` REST field. Same boolean, different name
	 * on the wire side. Null when SEMANTIC_DATA is missing.
	 */
	guestCheckout: boolean | null;
	/**
	 * eBay catalog product id — present when the listing is linked to a
	 * canonical catalog entry (`/p/{epid}`). Same identifier across every
	 * listing of the same SKU, so callers can group / dedup / shortcut
	 * matching without any LLM call. Mirror of Browse REST `getItem.epid`.
	 *
	 * Pulled from the "See more like this" / catalog link the PDP renders
	 * (`https://www.ebay.com/p/{epid}`), or the URL `?epid=` parameter on
	 * cross-product navigation links. Null when the listing isn't catalog-
	 * linked (custom resale items, sneakers without catalog mapping, etc.).
	 */
	epid: string | null;
	/**
	 * Manufacturer Part Number — Item Specifics row. Promoted to a top-level
	 * field to match Browse REST's `getItem.mpn`. Also a useful variant
	 * disambiguator when the title is silent (e.g. an iPhone listing whose
	 * title omits the storage capacity but whose MPN encodes it).
	 */
	mpn: string | null;
	/**
	 * Number of physical units the listing covers. Browse REST emits this as
	 * a top-level integer separate from `quantity`. Pulled from the "Lot
	 * Size" / "Number in lot" / "Number in pack" Item Specifics row. Null
	 * when the listing isn't a lot.
	 */
	lotSize: number | null;
	/**
	 * Long-form condition note from the seller (above-and-beyond the
	 * canonical `conditionText`). Mirror of Browse REST
	 * `getItem.conditionDescription`. Useful for distinguishing fulfilment
	 * notes ("BOX SOLD SEPARATELY") from actual defects.
	 */
	conditionDescription: string | null;
	/**
	 * Structured grade/cert rows — Browse REST `conditionDescriptors[]`.
	 * Pulled from the schema.org JSON-LD `additionalProperty` block when
	 * present; emitted in REST shape (`{name, values: [{content}]}`) so a
	 * single transform handles both transports.
	 *
	 * Populated for graded categories (PSA / BGS / CGC / SGC trading cards,
	 * professional grader-stamped jewelry, etc.) and a few condition-heavy
	 * verticals (CPU brand on used computers). Null when the listing has
	 * no JSON-LD structured-data block.
	 */
	conditionDescriptors: Array<{ name: string; values: Array<{ content: string }> }> | null;
	/**
	 * Strikethrough / list price + discount metadata when the listing
	 * advertises a markdown. Mirror of Browse REST `getItem.marketingPrice`.
	 * Pulled from the price block's STRIKETHROUGH `TextSpan` plus the
	 * adjacent "X% off" textspan. Strong fake-listing signal: a brand-new
	 * iPhone "$400 (was $1199, 67% off)" is almost always a replica.
	 */
	marketingPrice: {
		originalPrice: { value: string; currency: string };
		discountPercentage?: string;
	} | null;
	/**
	 * Multi-variation parent metadata — group id + (when available) parent
	 * title + group page href. Browse REST attaches this when the listing is
	 * one SKU of a `SELLER_DEFINED_VARIATIONS` group; from PDP markup we
	 * surface what we can find in the embedded JSON. Null when the listing
	 * isn't part of a variation group.
	 */
	primaryItemGroup: {
		itemGroupId: string;
		itemGroupTitle?: string;
		itemGroupHref?: string;
	} | null;
	/**
	 * Raw "X available" / "Last one" / "Out of Stock" / "More than X
	 * available" text from the page's `availabilitySignal` model
	 * (or the `#qtyAvailability` DOM element as fallback). Null on
	 * pages that omit the block — typically auctions and listings
	 * where eBay chose to hide the count. Parsed into a numeric
	 * `availableQuantity` at the `EbayItemDetail` boundary.
	 */
	availabilityText: string | null;
	/**
	 * Raw "X sold" / "1,746 sold" text from the same
	 * `availabilitySignal` model. Surfaces a fixed-price listing's
	 * rolling sold count (Browse REST `estimatedSoldQuantity`). Null
	 * when the page doesn't render the badge.
	 */
	soldQuantityText: string | null;
}

/**
 * Subset of eBay Browse REST `returnTerms` we surface from scrape. Same
 * field names + shapes eBay REST uses, so a single `extractReturns()` on
 * the API side handles both transports without branching.
 *
 * @see https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem (returnTerms block)
 */
export interface EbayReturnTerms {
	returnsAccepted: boolean;
	returnPeriod?: { value: number; unit: "DAY" };
	returnShippingCostPayer?: "BUYER" | "SELLER";
}

/**
 * One SKU of a multi-variation listing, joined from the page's `MSKU`
 * model: price comes from `MSKU.variationsMap[<id>].binModel.price`,
 * aspects are joined across `MSKU.selectMenus[].displayLabel` ↔
 * `MSKU.menuItemMap[i].displayName` via `matchingVariationIds`.
 *
 * `variationId` is the legacy eBay-side id (the `?var=<id>` URL
 * parameter, also what Browse REST encodes as the third segment of
 * `v1|<legacy>|<variationId>`).
 */
export interface EbayVariation {
	variationId: string;
	priceCents: number | null;
	currency: string;
	/** Per-axis aspects (e.g. `Size: US M8`, `Color: Black`). */
	aspects: Array<{ name: string; value: string }>;
	/** Per-variation image when eBay exposes one (REST item-group response
	 *  carries `item.image.imageUrl` for each SKU). Optional — many
	 *  multi-SKU listings share a single parent photo, in which case
	 *  callers fall back to the parent listing's hero image. */
	imageUrl?: string | null;
}

/**
 * Bracket-balanced extractor for the SEMANTIC_DATA JSON block embedded in
 * eBay's modern listing detail pages. eBay bootstraps page state via inline
 * `<script>` tags containing `"SEMANTIC_DATA":{...}` — we walk balanced
 * braces (string-aware) and JSON.parse the slice. Returns null when not
 * found or parse fails.
 */
function extractSemanticData(root: ParentNode): Record<string, unknown> | null {
	return extractScriptObject(root, "SEMANTIC_DATA");
}

/**
 * Pull the two textspans out of the page's `availabilitySignal` model
 * — the multi-quantity badge eBay renders next to BIN/quantity. Two
 * forms appear in the same `textSpans[]` array:
 *
 *   - availability: `"17 available"`, `"Last one"`, `"Out of Stock"`,
 *     `"More than 10 available"`
 *   - sold count:   `"10 sold"`, `"1,746 sold"`
 *
 * Either or both can be absent (627-sold listings show only the sold
 * span; auctions and single-item listings render nothing). Auction +
 * sold/ended pages omit the model entirely. We classify by content
 * (regex on the text) rather than positional index because eBay swaps
 * order across listings: high-stock listings put sold first, low-stock
 * listings put availability first.
 */
function extractAvailabilitySignal(root: ParentNode): {
	availabilityText: string | null;
	soldQuantityText: string | null;
} {
	const out = { availabilityText: null as string | null, soldQuantityText: null as string | null };
	const classify = (text: string) => {
		if (!text) return;
		if (!out.soldQuantityText && /\bsold\b/i.test(text)) out.soldQuantityText = text;
		else if (!out.availabilityText && /(available|last\s+one|out\s+of\s+stock)/i.test(text))
			out.availabilityText = text;
	};

	const block = extractScriptObject(root, "availabilitySignal") as { textSpans?: Array<{ text?: unknown }> } | null;
	for (const span of block?.textSpans ?? []) {
		if (typeof span.text === "string") classify(span.text.trim());
	}
	if (out.availabilityText || out.soldQuantityText) return out;
	// Fallback: walk the rendered DOM (`#qtyAvailability`). Same two
	// textspans, just unwrapped by eBay's renderer. Used when the inline
	// model is missing but the markup made it through (older layouts /
	// regional skins).
	const dom = root.querySelector("#qtyAvailability, .x-quantity__availability");
	if (!dom) return out;
	for (const span of Array.from(dom.querySelectorAll(".ux-textspans"))) {
		classify((span.textContent ?? "").trim());
	}
	return out;
}

/**
 * Brace-balanced extractor for a named JSON sub-object inside any
 * `<script>` tag's text. Walks balanced braces (string + escape aware)
 * starting from the first `{` after the marker key, then JSON.parses
 * the slice. Used to pull both `SEMANTIC_DATA` and `MSKU` blocks out
 * of eBay's bootstrap scripts. Returns null when the marker is absent
 * or the parse fails.
 */
function extractScriptObject(root: ParentNode, markerKey: string): Record<string, unknown> | null {
	const scripts = root.querySelectorAll("script");
	const marker = `"${markerKey}":`;
	for (const script of Array.from(scripts)) {
		const text = script.textContent ?? "";
		const keyIdx = text.indexOf(marker);
		if (keyIdx === -1) continue;
		const objStart = text.indexOf("{", keyIdx + marker.length);
		if (objStart === -1) continue;
		let depth = 0;
		let inString = false;
		let escaped = false;
		let objEnd = -1;
		for (let i = objStart; i < text.length; i++) {
			const c = text[i];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (c === "\\") {
				escaped = true;
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
			return JSON.parse(text.slice(objStart, objEnd)) as Record<string, unknown>;
		} catch {}
	}
	return null;
}

/**
 * Pull every variation's `{variationId, price, aspects}` out of the
 * page's `MSKU` (multi-SKU) bootstrap model. eBay encodes:
 *
 *   - `selectMenus[]`        — one entry per axis (Size, Color, …) with
 *                               `displayLabel` and the value-id list.
 *   - `menuItemMap[<id>]`    — per-axis value: `displayName`/`valueName`
 *                               + `matchingVariationIds`.
 *   - `variationsMap[<id>]`  — per-variation: `binModel.price.value`.
 *   - `selectedVariationId`  — which one the page rendered for.
 *
 * We join: for each `variationId` in `variationsMap`, walk every menu's
 * `menuItemMap` entries; entries whose `matchingVariationIds` contains
 * the variation contribute one `(displayLabel, displayName)` aspect.
 * Multi-axis listings (Size + Color) get one aspect per axis.
 *
 * Returns null when the listing isn't multi-variation — callers fall
 * back to the page's top-of-fold price + generic aspects.
 */
function extractMskuModel(root: ParentNode): {
	variations: EbayVariation[];
	selectedVariationId: string | null;
} | null {
	const msku = extractScriptObject(root, "MSKU");
	if (!msku) return null;
	const selectMenus = Array.isArray(msku.selectMenus) ? (msku.selectMenus as Array<Record<string, unknown>>) : [];
	const menuItemMap =
		msku.menuItemMap && typeof msku.menuItemMap === "object"
			? (msku.menuItemMap as Record<string, Record<string, unknown>>)
			: {};
	const variationsMap =
		msku.variationsMap && typeof msku.variationsMap === "object"
			? (msku.variationsMap as Record<string, Record<string, unknown>>)
			: {};
	const selectedRaw = msku.selectedVariationId;
	const selectedVariationId =
		typeof selectedRaw === "number" || typeof selectedRaw === "string" ? String(selectedRaw) : null;

	const variationIds = Object.keys(variationsMap);
	if (variationIds.length === 0) return null;

	const variations: EbayVariation[] = variationIds.map((variationId) => {
		const aspects: Array<{ name: string; value: string }> = [];
		for (const menu of selectMenus) {
			const axisName = typeof menu.displayLabel === "string" ? menu.displayLabel : null;
			if (!axisName) continue;
			const valueIds = Array.isArray(menu.menuItemValueIds) ? menu.menuItemValueIds : [];
			for (const valueId of valueIds) {
				const entry = menuItemMap[String(valueId)];
				if (!entry) continue;
				const matching = entry.matchingVariationIds;
				if (!Array.isArray(matching)) continue;
				if (!matching.some((m) => String(m) === variationId)) continue;
				const displayName = typeof entry.displayName === "string" ? entry.displayName : null;
				const valueName = typeof entry.valueName === "string" ? entry.valueName : null;
				const value = displayName || valueName;
				if (value) aspects.push({ name: axisName, value });
			}
		}
		const v = variationsMap[variationId] ?? {};
		const bin = v.binModel as Record<string, unknown> | undefined;
		const price = bin?.price as Record<string, unknown> | undefined;
		const priceVal = price?.value as Record<string, unknown> | undefined;
		const priceNum = typeof priceVal?.value === "number" ? priceVal.value : null;
		const currencyRaw = typeof priceVal?.currency === "string" ? priceVal.currency : null;
		const priceCents = priceNum != null ? Math.round(priceNum * 100) : null;
		return { variationId, priceCents, currency: currencyRaw ?? "USD", aspects };
	});
	return { variations, selectedVariationId };
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
	// Modern eBay listings render images via lazy-loaded carousel items;
	// the visible `src` is a 1x1 placeholder until the user scrolls,
	// while the real URL hides in `data-src` / `data-zoom-src` / srcset.
	// Selector list covers 2024+ layouts (`.ux-image-carousel*`,
	// `[data-testid='ux-image-carousel-item']`) plus older fixtures.
	// Attribute precedence is handled in `extractEbayDetail`.
	images: [
		".ux-image-carousel-item img",
		".ux-image-carousel-container img",
		".ux-image-magnify__image img",
		"[data-testid='ux-image-carousel-item'] img",
		"img[data-zoom-src]",
		"#icImg",
	],
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
	// Condition lives in the same `dl[data-testid="ux-labels-values"]`
	// Item Specifics table that `extractItemAspects` walks — but with the
	// `Condition` row explicitly skipped there to keep `condition` and
	// `localizedAspects` separate (matching Browse REST). We walk the
	// same table ourselves to pull just the Condition row (PDP renders
	// "Graded - PSA 10: Professionally graded ..." here; canonicalise
	// downstream maps it to the eBay enum).
	const dls = root.querySelectorAll<HTMLElement>('dl[data-testid="ux-labels-values"], dl.ux-labels-values');
	for (const dl of Array.from(dls)) {
		const labelEl = dl.querySelector(".ux-labels-values__labels");
		const valueEl = dl.querySelector(".ux-labels-values__values");
		if (!labelEl || !valueEl) continue;
		const name = aspectText(labelEl);
		if (!name || !/^condition$/i.test(name)) continue;
		const value = aspectText(valueEl);
		if (value) return value;
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

// Detect eBay's Authenticity Guarantee badge. SRP cards reference the
// shared icon symbol; PDP renders it as an explicit `aria-label` on the
// trust panel. Either match = AG-routed listing.
function hasAuthenticityGuarantee(root: ParentNode | Element): boolean {
	const el = root as Element;
	if (el.querySelector?.('use[href*="authenticity-guarantee"], [aria-label*="Authenticity Guarantee" i]')) {
		return true;
	}
	// Text fallback — the SRP card always renders the literal label next
	// to the icon. Cheap regex over `textContent` so test fixtures that
	// only carry the label still match.
	const text = el.textContent ?? "";
	return /Authenticity\s+Guarantee/i.test(text);
}

/**
 * eBay program enum that lands on `qualifiedPrograms` for AG-routed
 * listings. Single source of truth — referenced wherever AG is applied
 * to an item summary or detail (SRP scrape, browse-layout scrape, PDP
 * scrape, REST passthrough, downstream risk-scoring).
 */
export const AUTHENTICITY_GUARANTEE_PROGRAM = "AUTHENTICITY_GUARANTEE";

/**
 * Default visible label when only the boolean badge presence is known
 * (SRP card / browse-layout flag — neither carries a per-listing
 * descriptor string). PDP scrape uses the actual AG block text instead.
 */
const AUTHENTICITY_GUARANTEE_DEFAULT_DESCRIPTION = "Authenticity Guarantee";

/**
 * Wire-shape mirror of `getItem.authenticityGuarantee` + `qualifiedPrograms`.
 * One write site for all three scrape transports (SRP search, category
 * browse-layout, PDP detail) so callers never have to special-case which
 * source surfaced the flag.
 *
 * Pass `null`/`undefined` (or omit the descriptor) to leave the item
 * untouched — call sites can hand off raw extractor output without an
 * `if` guard.
 */
export function applyAuthenticityGuaranteeFields<
	T extends {
		authenticityGuarantee?: { description?: string; termsWebUrl?: string };
		qualifiedPrograms?: string[];
	},
>(item: T, descriptor: { description?: string; termsWebUrl?: string } | null | undefined): void {
	if (!descriptor) return;
	const block: { description: string; termsWebUrl?: string } = {
		description: descriptor.description ?? AUTHENTICITY_GUARANTEE_DEFAULT_DESCRIPTION,
	};
	if (descriptor.termsWebUrl) block.termsWebUrl = descriptor.termsWebUrl;
	item.authenticityGuarantee = block;
	item.qualifiedPrograms = [AUTHENTICITY_GUARANTEE_PROGRAM];
}

/**
 * Lift a boolean badge presence to a descriptor — call site convenience
 * for sources that only know "AG yes/no" (SRP DOM, browse-layout JSON
 * key) without an embedded text block. Returns `null` when absent so
 * the result feeds straight into `applyAuthenticityGuaranteeFields`.
 */
export function authenticityGuaranteeDescriptorFromFlag(present: boolean): { description: string } | null {
	return present ? { description: AUTHENTICITY_GUARANTEE_DEFAULT_DESCRIPTION } : null;
}

// Read `<meta name="description" content="…">` — eBay seeds this with
// the seller's first description paragraph, which is what Browse REST
// surfaces as `shortDescription`. eBay's PDP rendering sometimes serves
// a stripped variant where the meta tag is absent (we observed this on
// roughly 1-in-10 fetches) — in that case fall back to the `<title>`
// element minus the trailing " | eBay" suffix. The title alone isn't as
// rich as the description but it's always present.
function extractShortDescription(root: ParentNode): string | null {
	const r = root as Element;
	const meta = r.querySelector?.<HTMLMetaElement>('meta[name="description"]');
	const content = meta?.getAttribute("content")?.trim();
	if (content) return content;
	const titleEl = r.querySelector?.("title");
	const titleText = titleEl?.textContent?.trim();
	if (!titleText) return null;
	return titleText.replace(/\s*\|\s*eBay\s*$/i, "").trim() || null;
}

// Pull distinct payment brand names from the PDP payments section.
// eBay renders each accepted brand as a `<span ux-textspans--<BRAND>>`
// + `title=<Brand> aria-label=<Brand>` element. The visible spelling
// varies ("PayPal" vs "Paypal Credit", "Master Card" vs "Mastercard");
// we normalize to the REST `paymentMethodBrandType` enum form
// (UPPER_SNAKE) so the transform layer maps to REST's bucketed shape
// without per-brand string juggling. `PAYPAL_CREDIT` is the financing
// option — REST emits it as a separate brand under `WALLET`.
const PAYMENT_BRAND_NORMALIZER: ReadonlyArray<readonly [RegExp, string]> = [
	[/^paypal credit$/i, "PAYPAL_CREDIT"],
	[/^paypal$/i, "PAYPAL"],
	[/^apple\s*pay$/i, "APPLE_PAY"],
	[/^google\s*pay$/i, "GOOGLE_PAY"],
	[/^visa$/i, "VISA"],
	[/^master\s*card$/i, "MASTERCARD"],
	[/^discover$/i, "DISCOVER"],
	[/^american\s*express|^amex$/i, "AMERICAN_EXPRESS"],
	[/^diners\s*club$/i, "DINERS_CLUB"],
];

function normalizePaymentBrand(name: string): string | null {
	const trimmed = name.trim();
	for (const [re, key] of PAYMENT_BRAND_NORMALIZER) {
		if (re.test(trimmed)) return key;
	}
	return null;
}

function extractPaymentBrands(root: ParentNode): string[] {
	const r = root as Element;
	// `aria-label` is set on every payment icon and matches the visible
	// brand name; `title` carries the same string. Querying either gets us
	// the full set without depending on which attribute eBay rendered.
	const nodes = r.querySelectorAll?.<HTMLElement>("[aria-label], [title]");
	const seen = new Set<string>();
	const out: string[] = [];
	for (const el of Array.from(nodes ?? [])) {
		// Only consider elements inside a payment span (the brand-icon
		// wrapper carries `ux-textspans--<BRAND>` or sits inside a
		// `data-testid` payments scope). This avoids false positives from
		// random aria-labels elsewhere in the page.
		const cls = el.getAttribute("class") ?? "";
		const inPaymentSpan = /ux-textspans--/.test(cls);
		if (!inPaymentSpan) continue;
		const label = el.getAttribute("aria-label") ?? el.getAttribute("title");
		if (!label) continue;
		const key = normalizePaymentBrand(label);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

// Pull "Ships to" / "Excludes" comma-list values from the embedded
// shipping-section JSON. eBay renders both as `TextualDisplay` blocks
// in `SHIPPING_SECTION_MODULE`; the visible label is one TextSpan, the
// comma-joined country list is the next `values[].textualDisplays[].textSpans[].text`.
// We walk the raw HTML rather than the DOM because the relevant payload
// lives inside a JSON-encoded `<script>` tag — DOM nodes are the
// rendered surface, not the data behind them.
function extractShipToLocations(html: string | undefined): {
	regionIncluded: Array<{ regionName: string }>;
	regionExcluded: Array<{ regionName: string }>;
} | null {
	if (!html) return null;
	const pull = (label: string): Array<{ regionName: string }> => {
		const idx = html.indexOf(`"text":"${label}"`);
		if (idx === -1) return [];
		// After the label, eBay nests one or more `values[]` with the
		// comma list inside the next `textSpans[].text`. The slice cap
		// (1500 chars) keeps us inside the same TextualDisplay block —
		// past it we'd risk picking up an unrelated downstream label.
		const slice = html.slice(idx, idx + 1500);
		const m = /"values":\[\{[^}]*?"text":"([^"]+)"/s.exec(slice);
		const text = m?.[1];
		if (!text) return [];
		return text
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0)
			.map((regionName) => ({ regionName }));
	};
	const included = pull("Ships to");
	const excluded = pull("Excludes");
	if (included.length === 0 && excluded.length === 0) return null;
	return { regionIncluded: included, regionExcluded: excluded };
}

// Detect Authenticity Guarantee. eBay embeds the program icon symbol
// (`icon-authenticity-guarantee-{16,24,...}`) only on listings enrolled
// in the authenticator program — every reseller-bait category we care
// about (sneakers, handbags, watches, trading cards, fine jewelry).
// When present we extract the visible description from the PDP trust
// panel block: `[data-testid="ux-section-icon-with-details"]` whose
// icon is the AG one carries a `__data-item-text` row with the user-
// facing copy ("This item is shipped to an eBay authenticator before
// delivery."). REST exposes a slightly different copy + a `termsWebUrl`;
// the URL isn't in the PDP markup so we leave it undefined and let
// callers treat presence-of-block as the boolean signal.
function extractAuthenticityGuarantee(root: ParentNode): { description?: string } | null {
	const r = root as Element;
	if (!r.querySelector?.('use[href*="icon-authenticity-guarantee"]')) return null;
	const sections = r.querySelectorAll?.<HTMLElement>('[data-testid="ux-section-icon-with-details"]');
	for (const section of Array.from(sections ?? [])) {
		if (!section.querySelector('use[href*="icon-authenticity-guarantee"]')) continue;
		const desc = section.querySelector(".ux-section-icon-with-details__data-item-text");
		const text = desc?.textContent?.replace(/\s+/g, " ").trim();
		if (text) return { description: text };
		break;
	}
	return {};
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

/**
 * Detect Best Offer: eBay renders a literal "or Best Offer" SECONDARY
 * textspan next to the BIN price when the seller has Best Offer enabled.
 * The phrase is specific enough that exact text-match across all
 * `.ux-textspans--SECONDARY` spans avoids false positives without us
 * hard-coding the buy-box's surrounding container (which has churned
 * across layout revisions).
 */
function hasBestOffer(root: ParentNode): boolean {
	const spans = root.querySelectorAll<HTMLElement>("span.ux-textspans--SECONDARY");
	for (const s of Array.from(spans)) {
		const text = s.textContent?.trim();
		if (text === "or Best Offer") return true;
	}
	return false;
}

/**
 * Parse the schema.org `hasMerchantReturnPolicy` JSON-LD block embedded
 * in eBay's detail page and emit eBay-REST-shape `returnTerms`. eBay
 * publishes this block on every listing (duplicated for product/offer);
 * we read the first occurrence with substring regex (avoids needing to
 * locate + JSON.parse a full surrounding `<script type="application/ld+json">`
 * which itself is sometimes embedded inside a larger inline blob).
 *
 * Mapping (schema.org → eBay REST):
 *   returnPolicyCategory=MerchantReturnFiniteReturnWindow → returnsAccepted=true
 *   returnPolicyCategory=MerchantReturnNotPermitted        → returnsAccepted=false
 *   merchantReturnDays=N                                   → returnPeriod={value:N,unit:"DAY"}
 *   returnFees=FreeReturn                                  → returnShippingCostPayer="SELLER"
 *   returnFees=ReturnFeesCustomerResponsibility            → returnShippingCostPayer="BUYER"
 */
function extractReturnTerms(html: string | undefined): EbayReturnTerms | null {
	if (!html) return null;
	const m = html.match(/"hasMerchantReturnPolicy":\[\{([^}]+)\}/);
	if (!m) return null;
	const body = m[1] ?? "";
	const cat = body.match(/"returnPolicyCategory":"([^"]+)"/)?.[1] ?? "";
	if (cat.endsWith("MerchantReturnNotPermitted")) {
		return { returnsAccepted: false };
	}
	if (!cat.endsWith("MerchantReturnFiniteReturnWindow")) {
		return null;
	}
	const out: EbayReturnTerms = { returnsAccepted: true };
	const daysStr = body.match(/"merchantReturnDays":(\d+)/)?.[1];
	if (daysStr) {
		const days = Number(daysStr);
		if (Number.isFinite(days) && days >= 0) out.returnPeriod = { value: days, unit: "DAY" };
	}
	const fees = body.match(/"returnFees":"([^"]+)"/)?.[1] ?? "";
	if (fees.endsWith("FreeReturn")) out.returnShippingCostPayer = "SELLER";
	else if (fees.endsWith("ReturnFeesCustomerResponsibility")) out.returnShippingCostPayer = "BUYER";
	return out;
}

/**
 * Catalog product id (`epid`). Pulled from the PDP's "See more like this"
 * catalog link or any in-page navigation to `/p/{epid}`. The PDP doesn't
 * typically render `?epid=` as a URL parameter on its own /itm/ link, but
 * cross-listing nav tiles often do; we accept either form.
 *
 * Returns the first 6+ digit id we find. eBay's catalog ids are always
 * 7-11 digits, so the 6+ floor avoids accidentally matching shorter
 * numerics that share the URL space (auction prices, page numbers).
 */
function extractEpidFromHtml(html: string | undefined): string | null {
	if (!html) return null;
	const path = html.match(/\/p\/(\d{6,})/);
	if (path?.[1]) return path[1];
	const param = html.match(/[?&]epid=(\d{6,})/);
	if (param?.[1]) return param[1];
	return null;
}

/**
 * Manufacturer Part Number — Item Specifics row. Walks the already-parsed
 * `aspects` array rather than re-querying the DOM (cheaper, and aspect
 * extraction already handles eBay's "Read more" controls + `clipped`
 * variants). Falls back to the alternative naming "Manufacturer Part
 * Number" some categories use.
 */
function extractMpnFromAspects(aspects: ReadonlyArray<{ name: string; value: string }>): string | null {
	for (const a of aspects) {
		const n = a.name.toLowerCase();
		if (n === "mpn" || n === "manufacturer part number") return a.value;
	}
	return null;
}

/**
 * Lot size from Item Specifics. eBay categorises lot listings under
 * "Lot Size" (most categories), "Number in lot" (older shape), and
 * "Number in pack" (some grocery / supplement listings). Returns null
 * when no lot field is present (i.e. single-unit listing).
 */
function extractLotSizeFromAspects(aspects: ReadonlyArray<{ name: string; value: string }>): number | null {
	for (const a of aspects) {
		const n = a.name.toLowerCase();
		if (n === "lot size" || n === "number in lot" || n === "number in pack") {
			const num = Number.parseInt(a.value, 10);
			if (Number.isFinite(num)) return num;
		}
	}
	return null;
}

/**
 * Structured grade/cert rows from the schema.org JSON-LD `additionalProperty`
 * block embedded in the PDP. eBay populates this for graded trading cards
 * (PSA / BGS / CGC / SGC) and a few condition-heavy verticals (used CPUs,
 * graded coins). We emit Browse REST's shape (`{name, values: [{content}]}`)
 * so the normalize layer can pass it through without re-shaping.
 *
 * The block is plain JSON inside a `<script>` tag; we use a non-strict regex
 * scan because parsing the full document JSON-LD just to read one array is
 * expensive on a 1MB page.
 */
function extractConditionDescriptorsFromHtml(
	html: string | undefined,
): Array<{ name: string; values: Array<{ content: string }> }> | null {
	if (!html) return null;
	const block = html.match(/"additionalProperty"\s*:\s*\[([\s\S]*?)\]/);
	if (!block?.[1]) return null;
	const out: Array<{ name: string; values: Array<{ content: string }> }> = [];
	const propRegex = /"name"\s*:\s*"([^"]+)"\s*,\s*"value"\s*:\s*"([^"]+)"/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex.exec idiom
	while ((m = propRegex.exec(block[1])) !== null) {
		out.push({ name: m[1]!, values: [{ content: m[2]! }] });
	}
	return out.length > 0 ? out : null;
}

/**
 * Strikethrough / "compare-at" price plus the headline discount, when the
 * PDP renders one. eBay encodes the price block as a tree of `TextSpan`
 * nodes; the strikethrough node carries `styles: ["STRIKETHROUGH", ...]`
 * with an `accessibilityText` like "previous price $333.49", and a
 * sibling node carries the "X% off" tag.
 *
 * We use a regex over the raw HTML rather than walking the DOM because
 * the block is buried inside a JSON-encoded React payload, not a stable
 * CSS selector. Returns null when no strikethrough block is present.
 */
function extractMarketingPriceFromHtml(
	html: string | undefined,
): { originalPrice: { value: string; currency: string }; discountPercentage?: string } | null {
	if (!html) return null;
	// Match `"text":"$333.49","styles":["STRIKETHROUGH"...`. eBay always
	// quotes the prefix; tolerate any decimal precision and thousands sep.
	const priceMatch = html.match(/"text"\s*:\s*"\$([0-9][0-9,]*\.?[0-9]*)"\s*,\s*"styles"\s*:\s*\[\s*"STRIKETHROUGH"/);
	if (!priceMatch?.[1]) return null;
	const value = priceMatch[1].replace(/,/g, "");
	const discountMatch = html.match(/"text"\s*:\s*"(\d{1,3})% off"/);
	return {
		originalPrice: { value, currency: "USD" },
		discountPercentage: discountMatch?.[1],
	};
}

/**
 * Multi-variation parent metadata. eBay's PDP embeds the parent's group id
 * in the React payload under various keys depending on layout; we accept
 * `itemGroupId` (most common) and `itemGroupHref` (cross-link form). The
 * group title flows from `itemGroupTitle` when the embed includes it.
 *
 * Returns null when the listing isn't part of a variation group — distinct
 * from `variations` which is populated from the MSKU model on the parent
 * itself.
 */
function extractPrimaryItemGroupFromHtml(
	html: string | undefined,
): { itemGroupId: string; itemGroupTitle?: string; itemGroupHref?: string } | null {
	if (!html) return null;
	const idMatch = html.match(/"itemGroupId"\s*:\s*"(\d+)"/);
	const hrefMatch = html.match(/"itemGroupHref"\s*:\s*"([^"]+)"/);
	if (!idMatch && !hrefMatch) return null;
	const titleMatch = html.match(/"itemGroupTitle"\s*:\s*"([^"]+)"/);
	const id = idMatch?.[1] ?? hrefMatch?.[1]?.match(/\/(\d{8,})/)?.[1];
	if (!id) return null;
	return {
		itemGroupId: id,
		itemGroupTitle: titleMatch?.[1],
		itemGroupHref: hrefMatch?.[1],
	};
}

export function extractEbayDetail(root: ParentNode, sourceUrl: string, html?: string): RawEbayDetail {
	const breadcrumb = extractBreadcrumb(root);

	// eBay's image carousel lazy-loads — `src` is often a 1x1 GIF
	// placeholder until the user scrolls, while the real URL lives in
	// `data-zoom-src` (full-res) or `data-src`. `srcset` carries
	// resolution variants ("url 64w, url 500w") — we take the last
	// entry (highest density). Skip data: URIs and known placeholder
	// shapes so the parsed `imageUrls[0]` is the actual hero image.
	const imageNodes = Array.from(root.querySelectorAll<HTMLImageElement>(DETAIL_SELECTORS.images.join(", ")));
	const seen = new Set<string>();
	const imageUrls: string[] = [];
	for (const img of imageNodes) {
		const candidates: Array<string | null> = [
			img.getAttribute("data-zoom-src"),
			img.getAttribute("data-src"),
			img.getAttribute("src"),
		];
		const srcset = img.getAttribute("srcset");
		if (srcset) {
			const last = srcset.split(",").pop()?.trim().split(/\s+/)[0];
			if (last) candidates.push(last);
		}
		for (const url of candidates) {
			if (!url) continue;
			if (url.startsWith("data:")) continue;
			if (/(?:^|\/)blank|placeholder|spacer\.gif|fxxj3ttftm5ltcqnto1o4baovyl/i.test(url)) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			imageUrls.push(url);
			break; // one canonical URL per <img>
		}
	}

	const semantic = extractSemanticData(root);
	const itemLocationText = html ? extractLocationText(html) : null;
	const soldOutValue = semantic?.singleSkuOutOfStock;
	const aspects = extractItemAspects(root);
	const msku = extractMskuModel(root);
	const availability = extractAvailabilitySignal(root);

	return {
		itemId: extractItemIdFromUrl(sourceUrl),
		title: firstMatchText(root, DETAIL_SELECTORS.title) ?? "",
		priceText: firstMatchText(root, DETAIL_SELECTORS.price),
		conditionText: extractCondition(root),
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
		bestOfferEnabled: hasBestOffer(root),
		returnTerms: extractReturnTerms(html),
		variations: msku?.variations ?? null,
		selectedVariationId: msku?.selectedVariationId ?? null,
		authenticityGuarantee: extractAuthenticityGuarantee(root),
		shortDescription: extractShortDescription(root),
		paymentBrands: extractPaymentBrands(root),
		shipToLocations: extractShipToLocations(html),
		// SEMANTIC_DATA carries the canonical `immediatePay` and
		// `guestCheckout` (= REST `enabledForGuestCheckout`) flags. Reuse
		// the already-parsed `semantic` object instead of walking script
		// tags twice.
		immediatePay: typeof semantic?.immediatePay === "boolean" ? semantic.immediatePay : null,
		guestCheckout: typeof semantic?.guestCheckout === "boolean" ? semantic.guestCheckout : null,
		epid: extractEpidFromHtml(html),
		mpn: extractMpnFromAspects(aspects),
		lotSize: extractLotSizeFromAspects(aspects),
		// REST emits `conditionDescription` only when the seller adds a
		// free-text note BEYOND the canonical label; the canonical text
		// itself goes into `conditionText` above. We don't currently have a
		// reliable DOM target for that seller-supplied note (the expanded
		// "see all condition definitions" tooltip mixes eBay copy with the
		// note), so leave null until a separate signal is wired. This
		// matches REST's behaviour on standard listings (where the field is
		// absent) and avoids duplicating the canonical text into both
		// fields.
		conditionDescription: null,
		conditionDescriptors: extractConditionDescriptorsFromHtml(html),
		marketingPrice: extractMarketingPriceFromHtml(html),
		primaryItemGroup: extractPrimaryItemGroupFromHtml(html),
		availabilityText: availability.availabilityText,
		soldQuantityText: availability.soldQuantityText,
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
 * Detect a "Best Offer" signal in an SRP card's buying-format text. Stacks
 * with the dominant format from `normalizeBuyingFormat` (a card showing
 * "Buy It Now or Best Offer" yields FIXED_PRICE + BEST_OFFER) — eBay's
 * model treats Best Offer as an option layered on top of a base price,
 * never a standalone format. Mirrors the detail-page `bestOfferEnabled`
 * signal so search and detail produce the same buyingOptions shape.
 */
export function hasBestOfferFormat(text: string | string[] | null | undefined): boolean {
	if (text == null) return false;
	const joined = Array.isArray(text) ? text.join(" ") : text;
	return /best offer/i.test(joined);
}

/**
 * eBay's canonical condition labels and their numeric `conditionId` enums.
 * Source: eBay Marketplace Insights `condition` enum + Browse `conditionIds`
 * filter values. The display label is what shows up in `s-card__subtitle`
 * (e.g. `"Brand New"`, `"Pre-Owned"`); the id is what callers pass back
 * via the eBay-shape `filter=conditionIds:{1000}` Browse expression.
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
	// Trading-card / collectibles "Graded" condition — same id (2750) eBay
	// Browse REST emits as `condition: "Graded"` for PSA / BGS / CGC / SGC
	// slabbed listings. Without this row, scrape returned `null` for graded
	// cards; the matcher then couldn't filter graded vs raw in the same pool.
	// Listed BEFORE "Like New" so substring resolveConditionId() prefers it
	// when text begins with "Graded - PSA 10: ..." (PDP long-form).
	{ label: "Graded", id: "2750" },
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
 * Parse "5 sold", "5 sold of 10", "9 sold this week", "1,746 sold"
 * into an integer. Used for both search-card popularity and the PDP
 * `availabilitySignal` rolling sold count. Browse REST surfaces this
 * as `estimatedSoldQuantity` on detail and `totalSoldQuantity` on
 * search summaries. Comma-grouped numbers are accepted because the
 * PDP renders thousands with grouping ("1,746 sold").
 *
 * EBAY_US-locale only by intent — non-US marketplaces (EBAY_DE, EBAY_FR,
 * etc.) localize the verb and the thousands separator. The project only
 * wires `ebay_us` today; expand here when other adapters land.
 */
export function parseSoldQuantity(text: string | null): number | null {
	if (!text) return null;
	const match = text.match(/^([\d,]+)\s+sold/i);
	if (!match) return null;
	const digits = (match[1] ?? "").replace(/,/g, "");
	const n = Number.parseInt(digits, 10);
	return Number.isFinite(n) ? n : null;
}

/**
 * Parsed shape of the PDP `availabilitySignal` availability text.
 * Discriminated by `kind` so consumers branch on case rather than
 * reading three optional fields:
 *
 *   - `count`     concrete remaining stock ("17 available", "Last one")
 *   - `out`       depleted listing ("Out of Stock")
 *   - `threshold` count is masked behind a "More than X" badge
 */
export type AvailabilityParse =
	| { kind: "count"; quantity: number }
	| { kind: "out" }
	| { kind: "threshold"; threshold: number };

/**
 * Parse the PDP `availabilitySignal` availability text. eBay renders
 * five shapes on EBAY_US:
 *
 *   - `"17 available"` / `"1,234 available"`  → { kind: "count", quantity }
 *   - `"Last one"`                            → { kind: "count", quantity: 1 }
 *   - `"Out of Stock"`                        → { kind: "out" }
 *   - `"More than 10 available"`              → { kind: "threshold", threshold: 10 }
 *
 * Mirror of Browse REST `estimatedAvailabilities[0]`. The "More than"
 * case maps to REST's `availabilityThreshold + availabilityThresholdType`
 * pair — REST drops `estimatedAvailableQuantity` on those listings AND
 * carries the threshold integer, so we extract the integer here.
 *
 * Returns null when the text doesn't match a known availability shape.
 */
export function parseAvailableQuantity(text: string | null): AvailabilityParse | null {
	if (!text) return null;
	if (/^last\s+one\b/i.test(text)) return { kind: "count", quantity: 1 };
	if (/^out\s+of\s+stock\b/i.test(text)) return { kind: "out" };
	const more = text.match(/^more\s+than\s+([\d,]+)\s+available/i);
	if (more) {
		const n = Number.parseInt((more[1] ?? "").replace(/,/g, ""), 10);
		return Number.isFinite(n) ? { kind: "threshold", threshold: n } : null;
	}
	const m = text.match(/^([\d,]+)\s+available/i);
	if (!m) return null;
	const n = Number.parseInt((m[1] ?? "").replace(/,/g, ""), 10);
	return Number.isFinite(n) ? { kind: "count", quantity: n } : null;
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
/**
 * Strip seller-added detail from PDP condition text and return just the
 * canonical eBay label. PDPs often render long forms like
 * `"Graded - PSA 10: Professionally graded ..."` or `"New: A brand-new,
 * unused item ..."`; Browse REST exposes only the canonical label
 * (`"Graded"`, `"New"`). This brings scrape into line with REST so
 * downstream callers can compare condition text directly.
 *
 * Returns the canonical label when the text begins with one; otherwise
 * the original text is returned unchanged (seller-custom strings flow
 * through as-is).
 */
export function canonicaliseConditionText(text: string | null | undefined): string | null {
	if (!text) return null;
	const lower = text.toLowerCase().trim();
	for (const c of CANONICAL_CONDITIONS) {
		const lbl = c.label.toLowerCase();
		if (lower === lbl || lower.startsWith(`${lbl}:`) || lower.startsWith(`${lbl} -`) || lower.startsWith(`${lbl} `)) {
			return c.label;
		}
	}
	return text.trim();
}

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
