/**
 * Shared raw-scraper → Browse-API shape mappers. Used by both the
 * server-side scrape backend (Oxylabs) and the bridge backend (extension
 * sends raw `EbayItemDetail`, the API normalises to `ItemDetail` so the
 * wire shape is identical regardless of transport).
 */

import { type EbayItemDetail, resolveConditionId } from "@flipagent/ebay-scraper";
import type { ItemDetail, ItemLocation, LocalizedAspect, PaymentMethod } from "@flipagent/types/ebay/buy";

// Browse REST publishes a top-level `gtin` whenever the listing carries
// a UPC, EAN, or ISBN aspect. We follow the same precedence — UPC first
// (US-default) then EAN, then ISBN — so a single field always points at
// the most specific identifier eBay surfaced.
const GTIN_ASPECT_NAMES = ["UPC", "EAN", "ISBN"] as const;

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
	const conditionId = resolveConditionId(raw.condition);
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
	const aspects =
		matchedVariation && matchedVariation.aspects.length > 0
			? mergeAspects(baseAspects, matchedVariation.aspects)
			: baseAspects;
	const localizedAspects: LocalizedAspect[] | undefined =
		aspects.length > 0 ? aspects.map(({ name, value }) => ({ name, value, type: "STRING" })) : undefined;
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
		condition: raw.condition ?? undefined,
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
		mpn: findAspect(aspects, "MPN"),
		gtin: findGtin(aspects),
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
		// is a SKU of a multi-variation parent. Scrape only sees the group
		// id + the parent title (everything else lives behind a separate
		// `getItemsByItemGroup` call we'd rather not chain) — fill what
		// we have so the field shape stays compatible.
		primaryItemGroup:
			raw.variations && raw.variations.length > 0
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
 *   - listing has time-left counter            → AUCTION
 *   - otherwise (priced page rendered)         → FIXED_PRICE
 *   - "or Best Offer" textspan present         → also BEST_OFFER
 *   - listing ENDED/COMPLETED                  → omit (no live options)
 *
 * Returned `undefined` (not empty array) when the listing is no longer
 * live — the field is `Type.Optional` in the mirror, so omitting reads
 * correctly downstream.
 */
function deriveBuyingOptions(raw: EbayItemDetail): ItemDetail["buyingOptions"] {
	const status = raw.listingStatus?.toUpperCase();
	if (status === "ENDED" || status === "COMPLETED") return undefined;
	const opts: Array<"AUCTION" | "FIXED_PRICE" | "BEST_OFFER"> = [];
	if (raw.timeLeftText) opts.push("AUCTION");
	else opts.push("FIXED_PRICE");
	if (raw.bestOfferEnabled) opts.push("BEST_OFFER");
	return opts;
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

function synthAvailability(raw: EbayItemDetail): ItemDetail["estimatedAvailabilities"] {
	const status = raw.listingStatus?.toUpperCase();
	if (!status) return undefined;
	if (status === "ACTIVE") return [{ estimatedAvailabilityStatus: "IN_STOCK" }];
	if (status === "ENDED" || status === "COMPLETED") {
		return [
			{
				estimatedAvailabilityStatus: "OUT_OF_STOCK",
				estimatedAvailableQuantity: 0,
				estimatedSoldQuantity: raw.soldOut === true ? 1 : 0,
				estimatedRemainingQuantity: 0,
			},
		];
	}
	return undefined;
}
