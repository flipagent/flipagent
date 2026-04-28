/**
 * eBay-shape → quant.Listing adapter. Pulls the fields quant cares about out
 * of an `ItemSummary` (search result) or `ItemDetail` (single fetch). Caller
 * gets richer confidence scores when feeding ItemDetail because description
 * length + full image count are present there.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import type { ActiveAsk, Listing, MarketStats, PriceObservation } from "../quant/index.js";
import { summarizeMarket } from "../quant/index.js";

/** eBay returns dollar strings on the wire; quant wants cents. Round, not floor. */
export function toCents(dollarString: string | undefined | null): number {
	if (!dollarString) return 0;
	const n = Number.parseFloat(dollarString);
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function isItemDetail(item: ItemSummary | ItemDetail): item is ItemDetail {
	return "description" in item || "categoryPath" in item || "additionalImages" in item;
}

function pickBuyingFormat(item: ItemSummary | ItemDetail): "AUCTION" | "FIXED_PRICE" | undefined {
	const opts = item.buyingOptions ?? [];
	if (opts.includes("AUCTION")) return "AUCTION";
	if (opts.includes("FIXED_PRICE")) return "FIXED_PRICE";
	return undefined;
}

function imageCountOf(item: ItemSummary | ItemDetail): number {
	if (isItemDetail(item)) {
		const extra = item.additionalImages?.length ?? 0;
		return (item.image ? 1 : 0) + extra;
	}
	return item.thumbnailImages?.length ?? 0;
}

function descriptionLengthOf(item: ItemSummary | ItemDetail): number | undefined {
	return isItemDetail(item) && item.description ? item.description.length : undefined;
}

/** Convert an eBay-shaped item to the quant.Listing shape used by every algorithm. */
export function toQuantListing(item: ItemSummary | ItemDetail): Listing {
	const seller = item.seller;
	return {
		itemId: item.itemId,
		title: item.title,
		url: item.itemWebUrl,
		priceCents: toCents(item.price?.value),
		currency: item.price?.currency ?? "USD",
		shippingCents: item.shippingOptions?.[0]?.shippingCost ? toCents(item.shippingOptions[0].shippingCost.value) : 0,
		condition: item.condition,
		buyingFormat: pickBuyingFormat(item),
		bidCount: item.bidCount,
		watchCount: item.watchCount,
		endTime: item.itemEndDate,
		sellerFeedback: seller?.feedbackScore,
		sellerFeedbackPercent: seller?.feedbackPercentage ? Number.parseFloat(seller.feedbackPercentage) : undefined,
		imageCount: imageCountOf(item),
		descriptionLength: descriptionLengthOf(item),
	};
}

/**
 * Build `MarketStats` from sold comparables (and optionally currently-
 * active listings of the same SKU). Comps from
 * `/buy/marketplace_insights/v1_beta/item_sales/search` populate
 * `lastSoldDate` and `price`. Active listings from
 * `/buy/browse/v1/item_summary/search` populate the asks side.
 *
 * `details` is optional — when provided it lets us compute time-to-sell
 * per comp from `itemCreationDate` + (`itemEndDate` ?? `lastSoldDate`).
 * Missing detail entries are fine — those comps just contribute to
 * price stats without duration.
 *
 * `active` is optional too — when provided the returned `MarketStats`
 * carries `asks` populated, which unlocks the `below_asks` signal in
 * `score()` and lets `optimalListPrice` price competitively.
 */
export function marketFromComps(
	comps: ReadonlyArray<ItemSummary>,
	context: { keyword?: string; marketplace?: string; windowDays?: number } = {},
	details?: ReadonlyArray<ItemDetail>,
	active?: ReadonlyArray<ItemSummary>,
): MarketStats {
	const detailsById = new Map<string, ItemDetail>();
	if (details) {
		for (const d of details) detailsById.set(d.itemId, d);
	}
	const sold: PriceObservation[] = comps.map((c) => {
		const d = detailsById.get(c.itemId);
		const durationDays = computeDurationDays(c, d);
		return {
			priceCents: toCents(c.price?.value),
			soldAt: c.lastSoldDate,
			...(durationDays !== undefined ? { durationDays } : {}),
		};
	});
	const asks: ActiveAsk[] | undefined = active?.map((a) => ({
		priceCents: toCents(a.price?.value),
	}));
	return summarizeMarket(
		{ sold, asks },
		{
			keyword: context.keyword ?? "",
			marketplace: context.marketplace ?? "EBAY_US",
			windowDays: context.windowDays ?? 30,
		},
	);
}

/**
 * Days between listing creation and sale (or listing end).
 *   duration = end − start
 *   start    = detail.itemCreationDate
 *   end      = detail.itemEndDate ?? comp.lastSoldDate
 * Returns undefined when either timestamp is missing or unparseable.
 */
function computeDurationDays(comp: ItemSummary, detail: ItemDetail | undefined): number | undefined {
	const startIso = detail?.itemCreationDate;
	const endIso = detail?.itemEndDate ?? comp.lastSoldDate;
	if (!startIso || !endIso) return undefined;
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
	return (end - start) / 86_400_000;
}
