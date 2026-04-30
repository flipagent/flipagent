/**
 * Shared raw-scraper → Browse-API shape mappers. Used by both the
 * server-side scrape backend (Oxylabs) and the bridge backend (extension
 * sends raw `EbayItemDetail`, the API normalises to `ItemDetail` so the
 * wire shape is identical regardless of transport).
 */

import { type EbayItemDetail, resolveConditionId } from "@flipagent/ebay-scraper";
import type { ItemDetail, ItemLocation, LocalizedAspect } from "@flipagent/types/ebay/buy";

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

export function ebayDetailToBrowse(raw: EbayItemDetail): ItemDetail | null {
	if (!raw.itemId) return null;
	const conditionId = resolveConditionId(raw.condition);
	const aspects = raw.aspects ?? [];
	const localizedAspects: LocalizedAspect[] | undefined =
		aspects.length > 0 ? aspects.map(({ name, value }) => ({ name, value, type: "STRING" })) : undefined;
	const item: ItemDetail = {
		itemId: `v1|${raw.itemId}|0`,
		legacyItemId: raw.itemId,
		title: raw.title,
		itemWebUrl: raw.url,
		condition: raw.condition ?? undefined,
		conditionId: conditionId ?? undefined,
		price: raw.priceCents != null ? { value: (raw.priceCents / 100).toFixed(2), currency: raw.currency } : undefined,
		shippingOptions:
			raw.shippingCents != null
				? [{ shippingCost: { value: (raw.shippingCents / 100).toFixed(2), currency: raw.currency } }]
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
		gtin: findGtin(aspects),
		topRatedBuyingExperience: raw.topRatedBuyingExperience || undefined,
	};
	// Attach `returnTerms` as a runtime extension. The eBay-mirror
	// `ItemDetail` type doesn't declare it (mirror is intentionally narrow),
	// but the REST passthrough already carries it through at runtime via
	// the upstream JSON cast — adding it here gives scrape the same runtime
	// shape so `services/evaluate/returns.ts` reads both transports through
	// one extractor without branching.
	if (raw.returnTerms) {
		(item as Record<string, unknown>).returnTerms = raw.returnTerms;
	}
	return item;
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
