/**
 * Shared raw-scraper → Browse-API shape mappers. Used by both the
 * server-side scrape backend (Oxylabs) and the bridge backend (extension
 * sends raw `EbayItemDetail`, the API normalises to `ItemDetail` so the
 * wire shape is identical regardless of transport).
 */

import { canonicaliseConditionText, type EbayItemDetail, resolveConditionId } from "@flipagent/ebay-scraper";
import type { ItemDetail, ItemLocation, LocalizedAspect, PaymentMethod } from "@flipagent/types/ebay/buy";

// Browse REST publishes a top-level `gtin` whenever the listing carries
// a UPC, EAN, or ISBN aspect. We follow the same precedence — UPC first
// (US-default) then EAN, then ISBN — so a single field always points at
// the most specific identifier eBay surfaced.
const GTIN_ASPECT_NAMES = ["UPC", "EAN", "ISBN"] as const;

// Item Specifics rows that Browse REST treats as `conditionDescriptors[]`,
// not `localizedAspects[]`. eBay's PDP renders them as plain Item Specifics,
// but REST lifts them into the structured condition block. We match REST
// here so a graded-card listing reads identically across both transports
// (matcher/aspect-confirmation logic finds the grade in the same place
// regardless of source).
const GRADING_ASPECT_NAMES: ReadonlySet<string> = new Set([
	"Professional Grader",
	"Grade",
	"Certification Number",
	"Card Condition",
	"Year Manufactured",
	"Year",
]);

// JSON-LD `additionalProperty` uses condensed names ("Grading Service: PSA",
// "Grade: PSA 10"). Item Specifics — and Browse REST — use the canonical
// long form ("Professional Grader: Professional Sports Authenticator (PSA)",
// "Grade: 10"). When grading info comes only from JSON-LD (Item Specifics
// missed it), we expand to the REST shape so downstream callers see the
// canonical names.
const GRADING_SERVICE_LONG_FORM: ReadonlyMap<string, string> = new Map([
	["PSA", "Professional Sports Authenticator (PSA)"],
	["BGS", "Beckett Grading Services (BGS)"],
	["CGC", "Certified Guaranty Company (CGC)"],
	["SGC", "Sportscard Guaranty (SGC)"],
	["HGA", "Hybrid Grading Approach (HGA)"],
	["TAG", "Technical Authentication and Grading (TAG)"],
]);

function findAspect(aspects: ReadonlyArray<{ name: string; value: string }>, name: string): string | undefined {
	const hit = aspects.find((a) => a.name === name);
	return hit?.value || undefined;
}

function findGtin(aspects: ReadonlyArray<{ name: string; value: string }>): string | undefined {
	for (const name of GTIN_ASPECT_NAMES) {
		const v = findAspect(aspects, name);
		if (v) return v;
	}
	return undefined;
}

/**
 * Split Item Specifics rows into product aspects vs grading rows. Browse
 * REST puts grading data under `conditionDescriptors[]`, not
 * `localizedAspects[]`; we mirror that so a graded-card listing reads
 * identically through both transports. Returns the rows in REST's wire
 * shape (`{name, values: [{content}]}`) so callers can splice directly.
 */
function partitionGradingAspects(aspects: ReadonlyArray<{ name: string; value: string }>): {
	productAspects: Array<{ name: string; value: string }>;
	gradingDescriptors: Array<{ name: string; values: Array<{ content: string }> }>;
} {
	const product: Array<{ name: string; value: string }> = [];
	const grading: Array<{ name: string; values: Array<{ content: string }> }> = [];
	for (const a of aspects) {
		if (GRADING_ASPECT_NAMES.has(a.name)) {
			grading.push({ name: a.name, values: [{ content: a.value }] });
		} else {
			product.push(a);
		}
	}
	return { productAspects: product, gradingDescriptors: grading };
}

/**
 * Reshape JSON-LD `additionalProperty` rows into REST's canonical names.
 * JSON-LD uses condensed forms ("Grading Service: PSA", "Grade: PSA 10");
 * Browse REST emits the long form ("Professional Grader: Professional
 * Sports Authenticator (PSA)", "Grade: 10"). When the JSON-LD path is the
 * only source of grading data, this lifts it into REST's wire shape.
 */
function normaliseJsonLdConditionDescriptors(
	descriptors: ReadonlyArray<{ name: string; values: ReadonlyArray<{ content: string }> }>,
): Array<{ name: string; values: Array<{ content: string }> }> {
	const out: Array<{ name: string; values: Array<{ content: string }> }> = [];
	for (const d of descriptors) {
		let name = d.name;
		const values = d.values.map((v) => {
			let content = v.content;
			if (name === "Grading Service") {
				name = "Professional Grader";
				const long = GRADING_SERVICE_LONG_FORM.get(content.trim().toUpperCase());
				if (long) content = long;
			} else if (name === "Grade") {
				// "PSA 10" / "BGS 9.5" / "CGC 9" → strip the prefix to match REST.
				const m = content.match(/^(?:PSA|BGS|CGC|SGC|HGA|TAG)\s+(.+)$/i);
				if (m?.[1]) content = m[1];
			}
			return { content };
		});
		out.push({ name, values });
	}
	return out;
}

// Browse REST groups payment brands into three buckets:
//   WALLET      — PAYPAL, PAYPAL_CREDIT, APPLE_PAY, GOOGLE_PAY
//   CREDIT_CARD — VISA, MASTERCARD, DISCOVER, AMERICAN_EXPRESS, DINERS_CLUB
//   OTHER       — cash, money order, etc. (no brands)
// REST always emits a leading `{paymentMethodType: "OTHER"}` entry on
// listings that accept payment-on-delivery / wire transfer; we don't
// have a reliable PDP signal for that so we omit the `OTHER` bucket
// from scrape — REST callers still get it through passthrough.
const WALLET_BRANDS = new Set(["PAYPAL", "PAYPAL_CREDIT", "APPLE_PAY", "GOOGLE_PAY"]);

function bucketPaymentBrands(brands: readonly string[]): PaymentMethod[] {
	if (brands.length === 0) return [];
	const wallet: string[] = [];
	const credit: string[] = [];
	for (const b of brands) {
		if (WALLET_BRANDS.has(b)) wallet.push(b);
		else credit.push(b);
	}
	const out: PaymentMethod[] = [];
	if (wallet.length > 0) {
		out.push({
			paymentMethodType: "WALLET",
			paymentMethodBrands: wallet.map((paymentMethodBrandType) => ({ paymentMethodBrandType })),
		});
	}
	if (credit.length > 0) {
		out.push({
			paymentMethodType: "CREDIT_CARD",
			paymentMethodBrands: credit.map((paymentMethodBrandType) => ({ paymentMethodBrandType })),
		});
	}
	return out;
}

export function ebayDetailToBrowse(raw: EbayItemDetail, variationId?: string): ItemDetail | null {
	if (!raw.itemId) return null;
	// Normalize the long-form PDP condition text ("Graded - PSA 10:
	// Professionally graded ...") down to the canonical eBay label
	// ("Graded") so scrape matches Browse REST's `condition` field exactly.
	// Without this, graded listings emitted the full PDP text and then failed
	// resolveConditionId() because the substring scan didn't find a clean
	// canonical prefix.
	const condition = canonicaliseConditionText(raw.condition);
	const conditionId = resolveConditionId(condition);
	const baseAspects = raw.aspects ?? [];

	// Multi-SKU listings carry per-variation aspects (Size, Color, …) inside
	// the page's MSKU model — distinct from the generic top-of-fold aspects
	// that look the same regardless of which variation the page rendered
	// for. When the caller asked about a specific variation, splice that
	// variation's aspects on top so the matcher LLM sees the variation-tier
	// signal it needs to filter mismatched-size sold listings out of the
	// pool. Without this, "Size: PS 3Y" and "Size: US M8" both look like
	// the same parent listing.
	const matchedVariation =
		variationId && raw.variations ? raw.variations.find((v) => v.variationId === variationId) : null;
	const mergedAspects =
		matchedVariation && matchedVariation.aspects.length > 0
			? mergeAspects(baseAspects, matchedVariation.aspects)
			: baseAspects;
	// Lift grading rows ("Professional Grader", "Grade", "Certification
	// Number") out of localizedAspects into conditionDescriptors so the
	// REST-shape parity holds. When the page's Item Specifics already carry
	// those rows, prefer them over the JSON-LD additionalProperty path —
	// Item Specifics use REST's canonical naming, JSON-LD uses condensed
	// names that require expansion.
	const { productAspects: aspects, gradingDescriptors } = partitionGradingAspects(mergedAspects);
	const localizedAspects: LocalizedAspect[] | undefined =
		aspects.length > 0 ? aspects.map(({ name, value }) => ({ name, value, type: "STRING" })) : undefined;
	// Prefer Item Specifics grading rows (REST's source); fall back to the
	// JSON-LD additionalProperty rows (normalised to REST shape) when Item
	// Specifics didn't surface any.
	const conditionDescriptors =
		gradingDescriptors.length > 0
			? gradingDescriptors
			: raw.conditionDescriptors
				? normaliseJsonLdConditionDescriptors(raw.conditionDescriptors)
				: undefined;
	// When the caller specified a variation, encode it in the v1 itemId
	// (`v1|<legacy>|<variationId>` is eBay's native shape) so downstream
	// services that re-parse the id naturally carry the variation. The
	// `|0` sentinel stays the default for non-variation listings.
	const v1Suffix = variationId && /^\d+$/.test(variationId) ? variationId : "0";
	// Defensive: prefer the variation's own price from MSKU when we know
	// which variation the caller wanted. The scraper already navigates to
	// `?var=<id>`, so the rendered top-of-fold price *should* already match
	// — but if eBay ever serves a stale render or a different default we'd
	// rather use the JSON-encoded ground truth than the DOM scrape.
	const priceCents = matchedVariation?.priceCents ?? raw.priceCents;
	const currency = matchedVariation?.currency ?? raw.currency;
	const item: ItemDetail = {
		itemId: `v1|${raw.itemId}|${v1Suffix}`,
		legacyItemId: raw.itemId,
		title: raw.title,
		itemWebUrl: raw.url,
		condition: condition ?? undefined,
		conditionId: conditionId ?? undefined,
		price: priceCents != null ? { value: (priceCents / 100).toFixed(2), currency } : undefined,
		shippingOptions:
			raw.shippingCents != null
				? [{ shippingCost: { value: (raw.shippingCents / 100).toFixed(2), currency } }]
				: undefined,
		buyingOptions: deriveBuyingOptions(raw),
		bidCount: raw.bidCount ?? undefined,
		watchCount: raw.watchCount ?? undefined,
		itemCreationDate: raw.itemCreationDate ?? undefined,
		itemEndDate: raw.itemEndDate ?? undefined,
		listingMarketplaceId: raw.marketplaceListedOn ?? undefined,
		itemLocation: parseItemLocation(raw.itemLocationText),
		estimatedAvailabilities: synthAvailability(raw),
		seller: raw.seller.name
			? {
					username: raw.seller.name,
					feedbackScore: raw.seller.feedbackScore ?? undefined,
					feedbackPercentage:
						raw.seller.feedbackPercent != null ? raw.seller.feedbackPercent.toFixed(1) : undefined,
				}
			: undefined,
		description: raw.description ?? undefined,
		categoryPath: raw.categoryPath.length > 0 ? raw.categoryPath.join("|") : undefined,
		categoryId: raw.categoryIds.length > 0 ? raw.categoryIds[raw.categoryIds.length - 1] : undefined,
		categoryIdPath: raw.categoryIds.length > 0 ? raw.categoryIds.join("|") : undefined,
		// eBay Browse REST splits images into a single primary + an array
		// of extras. Match that shape: first url → `image`, rest →
		// `additionalImages`. Without this, the playground item hero, match
		// thumbnails, and observations.imageUrl all read empty.
		image: raw.imageUrls[0] ? { imageUrl: raw.imageUrls[0] } : undefined,
		additionalImages: raw.imageUrls.length > 1 ? raw.imageUrls.slice(1).map((url) => ({ imageUrl: url })) : undefined,
		localizedAspects,
		brand: findAspect(aspects, "Brand"),
		color: findAspect(aspects, "Color"),
		size: findAspect(aspects, "Size") ?? matchedVariation?.aspects.find((a) => a.name === "Size")?.value,
		pattern: findAspect(aspects, "Pattern"),
		material: findAspect(aspects, "Material"),
		sizeType: findAspect(aspects, "Size Type"),
		mpn: raw.mpn ?? findAspect(aspects, "MPN"),
		gtin: findGtin(aspects),
		epid: raw.epid ?? undefined,
		// Browse REST emits `lotSize: 0` for normal (non-lot) listings; only
		// emits a positive integer for actual lots. Match that wire shape so
		// callers can use a consistent "lotSize > 0 = lot" check across both
		// transports.
		lotSize: raw.lotSize ?? 0,
		conditionDescription: raw.conditionDescription ?? undefined,
		conditionDescriptors,
		marketingPrice: raw.marketingPrice
			? {
					originalPrice: raw.marketingPrice.originalPrice,
					discountPercentage: raw.marketingPrice.discountPercentage,
					priceTreatment: "STRIKETHROUGH",
				}
			: undefined,
		// REST always emits `topRatedBuyingExperience` as an explicit
		// boolean — emit the same wire shape from scrape so consumers
		// can do `.topRatedBuyingExperience === false` without a
		// `=== undefined` fallback. Same applies to `immediatePay` and
		// `enabledForGuestCheckout` below.
		topRatedBuyingExperience: raw.topRatedBuyingExperience,
		shortDescription: raw.shortDescription ?? undefined,
		paymentMethods: raw.paymentBrands.length > 0 ? bucketPaymentBrands(raw.paymentBrands) : undefined,
		shipToLocations: raw.shipToLocations ?? undefined,
		immediatePay: raw.immediatePay ?? undefined,
		enabledForGuestCheckout: raw.guestCheckout ?? undefined,
		// Mirror Browse REST: when the listing carries the AG badge, surface
		// both `authenticityGuarantee` (the descriptor block) and
		// `qualifiedPrograms` (the program enum REST emits). PDP markup
		// doesn't expose `termsWebUrl` so we omit it here — REST callers
		// still get the canonical link from upstream.
		authenticityGuarantee: raw.authenticityGuarantee ?? undefined,
		qualifiedPrograms: raw.authenticityGuarantee ? ["AUTHENTICITY_GUARANTEE"] : undefined,
		// `returnTerms` is now declared on the schema (mirror parity with
		// REST). REST passthrough already populates it; scrape fills from
		// the JSON-LD `hasMerchantReturnPolicy` block parsed in
		// ebay-extract.ts, so consumers read both transports identically.
		returnTerms: raw.returnTerms ?? undefined,
		// `primaryItemGroup` is what Browse REST attaches when the listing
		// is a SKU of a multi-variation parent. Prefer the parser's extracted
		// value (group id from the embedded React payload) when available;
		// fall back to a self-derived block when this listing's own MSKU
		// model exposed variations (i.e. it IS the parent). Either way the
		// field shape stays compatible with REST consumers.
		primaryItemGroup: raw.primaryItemGroup
			? {
					itemGroupId: raw.primaryItemGroup.itemGroupId,
					itemGroupHref: raw.primaryItemGroup.itemGroupHref,
					itemGroupTitle: raw.primaryItemGroup.itemGroupTitle ?? (raw.title || undefined),
					itemGroupType: "SELLER_DEFINED_VARIATIONS",
					itemGroupImage: raw.imageUrls[0] ? { imageUrl: raw.imageUrls[0] } : undefined,
				}
			: raw.variations && raw.variations.length > 0
				? {
						itemGroupId: raw.itemId,
						itemGroupType: "SELLER_DEFINED_VARIATIONS",
						itemGroupTitle: raw.title || undefined,
						itemGroupImage: raw.imageUrls[0] ? { imageUrl: raw.imageUrls[0] } : undefined,
					}
				: undefined,
	};
	// Surface the full variation list as a runtime extension so callers
	// (MCP, SDK, dashboard) can render "this listing has 6 sizes, here are
	// the prices" without re-fetching. Mirror's ItemDetail intentionally
	// stays narrow on this one — variations is a flipagent convenience,
	// not an eBay REST field. Callers that don't know about it just ignore.
	if (raw.variations && raw.variations.length > 0) {
		(item as Record<string, unknown>).variations = raw.variations;
		if (raw.selectedVariationId) {
			(item as Record<string, unknown>).selectedVariationId = raw.selectedVariationId;
		}
	}
	return item;
}

/**
 * Merge per-variation aspects (Size, Color) on top of the page's
 * generic aspects. Variation values win on collision — they're the
 * SKU-specific truth for axes the listing varies on. Generic aspects
 * (Brand, Department, Vintage) flow through unchanged.
 */
function mergeAspects(
	base: ReadonlyArray<{ name: string; value: string }>,
	overrides: ReadonlyArray<{ name: string; value: string }>,
): Array<{ name: string; value: string }> {
	const overrideNames = new Set(overrides.map((a) => a.name));
	const filtered = base.filter((a) => !overrideNames.has(a.name));
	return [...filtered, ...overrides];
}

/**
 * Derive `buyingOptions` from the scraped detail signals. eBay's REST
 * surfaces this directly; from HTML we assemble it:
 *
 *   - bidCount field is non-null                → AUCTION
 *   - listing has time-left counter             → AUCTION
 *   - otherwise (priced page rendered)          → FIXED_PRICE
 *   - "or Best Offer" textspan present          → also BEST_OFFER
 *   - listing ENDED/COMPLETED                   → omit (no live options)
 *
 * `bidCount !== null` is the load-bearing signal: the scraper's
 * `.x-bid-count` / `#qtySubTxt` selectors only match the auction PDP's
 * "X bids" widget, which BIN listings don't render at all — so an
 * explicit numeric `bidCount` (including 0 for a freshly-listed
 * zero-bid auction) means the page is auction-format. `timeLeftText`
 * is a redundant signal for the same case but kept as belt-and-
 * suspenders. `itemEndDate` is *not* an auction signal: BIN listings
 * carry one too (7/30-day fixed-price durations, GTC), so using it
 * as a fallback caused 30-day BINs to mis-tag as auctions.
 *
 * Returned `undefined` (not empty array) when the listing is no longer
 * live — the field is `Type.Optional` in the mirror, so omitting reads
 * correctly downstream.
 */
function deriveBuyingOptions(raw: EbayItemDetail): ItemDetail["buyingOptions"] {
	const status = raw.listingStatus?.toUpperCase();
	if (status === "ENDED" || status === "COMPLETED") return undefined;
	const opts: Array<"AUCTION" | "FIXED_PRICE" | "BEST_OFFER"> = [];
	if (isLiveAuctionSignal(raw)) opts.push("AUCTION");
	else opts.push("FIXED_PRICE");
	if (raw.bestOfferEnabled) opts.push("BEST_OFFER");
	return opts;
}

function isLiveAuctionSignal(raw: { bidCount?: number | null; timeLeftText?: string | null }): boolean {
	if (raw.bidCount != null) return true;
	if (raw.timeLeftText) return true;
	return false;
}

/**
 * Reconcile `buyingOptions` against bid signals on a Browse-shape
 * `ItemDetail`. eBay's Browse REST sometimes reports `["FIXED_PRICE"]`
 * on a live auction once bidding has pushed past the BIN floor (the
 * AUCTION enum gets dropped from the response even though `bidCount`
 * and `itemEndDate` are still set). The PDP scraper has the symmetric
 * blind spot when its time-left selector misses.
 *
 * When `bidCount > 0` we know the listing is auction-format
 * (Best Offer + BIN both vanish on first bid), so any non-AUCTION
 * options on the upstream record are stale. Replace with `["AUCTION"]`.
 *
 * No-op when the detail already lists AUCTION, when there are no bids,
 * or when the listing is no longer in stock (ENDED listings keep
 * whatever options the upstream returned — useful for sold-comp lookups).
 */
export function reconcileBuyingOptions(detail: ItemDetail): ItemDetail {
	const status = detail.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus;
	if (status === "OUT_OF_STOCK") return detail;
	if ((detail.bidCount ?? 0) <= 0) return detail;
	if (detail.buyingOptions?.includes("AUCTION")) return detail;
	return { ...detail, buyingOptions: ["AUCTION"] };
}

function parseItemLocation(text: string | null | undefined): ItemLocation | undefined {
	if (!text) return undefined;
	const parts = text
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length === 3) {
		const country = parts[2];
		return {
			city: parts[0] || undefined,
			stateOrProvince: parts[1] || undefined,
			country: country === "United States" ? "US" : country,
		};
	}
	if (parts.length === 2) {
		const country = parts[1];
		return { city: parts[0] || undefined, country: country === "United States" ? "US" : country };
	}
	if (parts.length === 1) return { country: parts[0] };
	return undefined;
}

/**
 * Build the `estimatedAvailabilities[]` block REST emits, using the
 * scraped page signals. eBay PDPs surface availability in two places:
 *
 *   - SEMANTIC_DATA `listingStatus` + `singleSkuOutOfStock` (lifecycle)
 *   - `availabilitySignal` model: "X available" + "X sold" textspans
 *     (rolling counts on fixed-price listings)
 *
 * For ENDED/COMPLETED listings we know the listing is depleted: emit
 * OUT_OF_STOCK with zeroes (matches REST's wire shape for sold comps).
 *
 * For ACTIVE listings we surface whatever numeric counts the page gave
 * us. `availableQuantity`, `availabilityThreshold`, and `soldQuantity`
 * are populated from the availabilitySignal — concrete integers when the
 * page rendered them, null when it didn't (auctions, listings with no
 * badge). Drop the count fields entirely when null so callers can
 * distinguish "0 left" from "unknown count" via field presence, the same
 * way REST does. `estimatedRemainingQuantity` mirrors
 * `estimatedAvailableQuantity` for normal listings.
 *
 * "More than N available" → emit `availabilityThreshold: N` and
 * `availabilityThresholdType: "MORE_THAN"`, leave the quantity field
 * absent — exactly what REST does on listings where the seller's
 * "Display More than {N} available" preference is on. We don't have the
 * true `estimatedRemainingQuantity` (the page hides it), but we mirror
 * REST's structural shape so consumers can render "More than 10
 * available" verbatim.
 *
 * Empirically REST emits only `IN_STOCK` and `OUT_OF_STOCK` on every
 * listing we've sampled (135 across diverse queries, 2026-05) — the docs
 * mention `LIMITED_STOCK` but it never appeared in practice, so we don't
 * synthesise it. Keeps scrape ↔ REST parity exact.
 */
function synthAvailability(raw: EbayItemDetail): ItemDetail["estimatedAvailabilities"] {
	const status = raw.listingStatus?.toUpperCase();
	const deliveryOptions = deriveDeliveryOptions(raw);
	if (status === "ENDED" || status === "COMPLETED") {
		// estimatedSoldQuantity is omitted when the page didn't render a
		// rolling sold count — eBay shows OUT_OF_STOCK for soldOut listings
		// without exposing how many sold (could be 1, could be 30). Don't
		// fabricate `1` from `soldOut === true`; let consumers treat the
		// field's absence as "unknown" the same way REST does on listings
		// with no count badge.
		const entry: NonNullable<ItemDetail["estimatedAvailabilities"]>[number] = {
			estimatedAvailabilityStatus: "OUT_OF_STOCK",
			estimatedAvailableQuantity: 0,
			estimatedRemainingQuantity: 0,
		};
		if (raw.soldQuantity !== null) entry.estimatedSoldQuantity = raw.soldQuantity;
		if (deliveryOptions) entry.deliveryOptions = deliveryOptions;
		return [entry];
	}
	if (status !== "ACTIVE") return undefined;
	const avail = raw.availableQuantity;
	const threshold = raw.availabilityThreshold;
	const sold = raw.soldQuantity;
	const isOutOfStock = avail === 0 || raw.soldOut === true;
	const entry: NonNullable<ItemDetail["estimatedAvailabilities"]>[number] = {
		estimatedAvailabilityStatus: isOutOfStock ? "OUT_OF_STOCK" : "IN_STOCK",
	};
	if (avail !== null) {
		entry.estimatedAvailableQuantity = avail;
		entry.estimatedRemainingQuantity = avail;
	}
	if (threshold !== null) {
		entry.availabilityThreshold = threshold;
		entry.availabilityThresholdType = "MORE_THAN";
	}
	if (sold !== null) entry.estimatedSoldQuantity = sold;
	if (deliveryOptions) entry.deliveryOptions = deliveryOptions;
	return [entry];
}

/**
 * Mirror REST's `estimatedAvailabilities[].deliveryOptions[]` enum from
 * the scraped page signals. Verified against live REST 2026-05:
 *
 *   - shippable listing  → REST emits `["SHIP_TO_HOME"]`
 *   - local-pickup-only  → REST omits the field entirely (no shipping
 *                          options in REST either)
 *
 * scrape sees the same partition through `shippingCents`: the PDP only
 * renders a shipping cost / "Free delivery" line when at least one
 * carrier service is offered. Mirror that 1:1 — emit `["SHIP_TO_HOME"]`
 * when scrape captured a shipping cost, omit otherwise. PICKUP /
 * DIGITAL_DELIVERY enums need different signals that the PDP doesn't
 * expose in a structured way (eBay renders user-facing copy like "Local
 * Pickup" but no enum), so we leave them off the scrape path until a
 * reliable signal lands. Listings that fall through still match REST,
 * because REST also omits `deliveryOptions` on the same listings.
 */
function deriveDeliveryOptions(raw: EbayItemDetail): string[] | null {
	if (raw.shippingCents !== null && raw.shippingCents !== undefined) return ["SHIP_TO_HOME"];
	if (raw.shipToLocations) return ["SHIP_TO_HOME"];
	return null;
}
