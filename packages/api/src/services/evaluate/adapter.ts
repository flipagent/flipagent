/**
 * eBay-shape → QuantListing adapter. Pulls the fields quant cares about
 * out of an `ItemSummary` (search result) or `ItemDetail` (single fetch).
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { rollingSoldCount } from "../items/transform.js";
import type { ActiveAsk, MarketStats, PriceObservation, QuantListing } from "../quant/index.js";
import {
	blendSalesPerDay,
	seedListingRate,
	sellerTrust,
	summarizeMarket,
	weightedMedian,
	weightedStd,
} from "../quant/index.js";
import { toCents } from "../shared/money.js";

/**
 * Whether a listing is fronted by eBay's Authenticity Guarantee program.
 * The badge replaces the seller-feedback line on the active SRP entirely
 * (~0% seller-presence on AG categories like luxury watches), so seller-
 * trust over those listings reads as zero — and gets weighted out of the
 * legit reference + over-flagged as fraud. AG presence is the explicit
 * trust signal eBay underwrites; treat it as max trust independent of
 * feedback fields. Used both here (cohort weighting) and in
 * `evaluate/suspicious.ts` + `evaluate/evaluate.ts` (per-item trust
 * shortcut). Single predicate so the two sides never drift.
 *
 * Structural input — accepts `ItemSummary`, `ItemDetail`, or any shape
 * that exposes the same two fields, so callers don't need a cast.
 */
export function isAuthenticityGuaranteed(item: {
	authenticityGuarantee?: { description?: string; termsWebUrl?: string };
	qualifiedPrograms?: ReadonlyArray<string>;
}): boolean {
	if (item.authenticityGuarantee) return true;
	return Array.isArray(item.qualifiedPrograms) && item.qualifiedPrograms.includes("AUTHENTICITY_GUARANTEE");
}

/**
 * Trust-weighted legit market reference for the price-anomaly Bayes update
 * in `assessRisk`. Each sold listing contributes to the median/std with
 * weight = its seller's `sellerTrust(...)`, OR weight = 1 when the listing
 * is AG-routed (eBay-underwritten authenticity). Returns null when total
 * trust weight is below 1 — the market is dominated by unverified sellers
 * and there is no clean reference. The price-anomaly signal is then
 * suppressed (priceBF = 1) rather than fabricated from noise.
 *
 * Symmetric: the same `sellerTrust(fb, pct)` from `quant/risk` runs both
 * here (filtering the supply-side cohort) and inside `assessRisk` (tempering
 * the candidate's price evidence). AG short-circuits both sides identically
 * — a credible identity (the program itself) doesn't price like fraud-bait.
 */
export function legitMarketReference(
	sold: ReadonlyArray<ItemSummary>,
): { medianCents: number; stdDevCents: number } | null {
	const samples = sold
		.map((s) => ({
			value: toCents(s.price?.value),
			weight: isAuthenticityGuaranteed(s)
				? 1
				: sellerTrust(
						s.seller?.feedbackScore,
						s.seller?.feedbackPercentage ? Number.parseFloat(s.seller.feedbackPercentage) : undefined,
					),
		}))
		.filter((s) => s.value > 0);
	const totalTrust = samples.reduce((acc, s) => acc + s.weight, 0);
	if (totalTrust < 1) return null;

	const medianCents = weightedMedian(samples);
	const stdDevCents = weightedStd(samples);
	if (medianCents == null || stdDevCents == null) return null;
	return { medianCents, stdDevCents };
}

function pickBuyingFormat(item: ItemSummary | ItemDetail): "AUCTION" | "FIXED_PRICE" | undefined {
	const opts = item.buyingOptions ?? [];
	if (opts.includes("AUCTION")) return "AUCTION";
	if (opts.includes("FIXED_PRICE")) return "FIXED_PRICE";
	return undefined;
}

/** Convert an eBay-shaped item to the QuantListing shape used by every algorithm. */
export function toQuantListing(item: ItemSummary | ItemDetail): QuantListing {
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
	};
}

/**
 * Build `MarketStats` from a sold pool (and optionally a same-product
 * active pool). Sold listings from
 * `/buy/marketplace_insights/v1_beta/item_sales/search` populate
 * `lastSoldDate` and `price`. Active listings from
 * `/buy/browse/v1/item_summary/search` populate the asks side.
 *
 * `details` is optional — when provided it lets us compute time-to-sell
 * per listing from `itemCreationDate` + (`itemEndDate` ?? `lastSoldDate`).
 * Missing detail entries are fine — those listings just contribute to
 * price stats without duration.
 *
 * `active` is optional too — when provided the returned `MarketStats`
 * carries `asks` populated, which feeds the cooling-drift detection and
 * queue-position calculation in `recommendListPrice`.
 *
 * `seed` is optional — when the seed listing is multi-quantity and has
 * shipped some units already, its per-listing rate
 * (`estimatedSoldQuantity / clamp(days_since_creation, 1..60)`) blends
 * into `salesPerDay` via `blendSalesPerDay`. Asymmetric: only RAISES
 * the rate. The pre-blend rate is preserved on `salesPerDayBaseline`
 * and the seed rate on `salesPerDaySeed` so callers can render the
 * breakdown ("comp pool says 0.5/day, this listing is moving 2/day,
 * forecast at sqrt(1) = 1/day").
 */
export function marketFromSold(
	sold: ReadonlyArray<ItemSummary>,
	context: { keyword?: string; marketplace?: string; windowDays?: number } = {},
	details?: ReadonlyArray<ItemDetail>,
	active?: ReadonlyArray<ItemSummary>,
	seed?: ItemSummary | ItemDetail,
): MarketStats {
	const detailsById = new Map<string, ItemDetail>();
	if (details) {
		for (const d of details) detailsById.set(d.itemId, d);
	}
	const observations: PriceObservation[] = sold.map((s) => {
		const d = detailsById.get(s.itemId);
		const durationDays = computeDurationDays(s, d);
		return {
			priceCents: toCents(s.price?.value),
			soldAt: s.lastSoldDate,
			...(durationDays !== undefined ? { durationDays } : {}),
		};
	});
	const asks: ActiveAsk[] | undefined = active?.map((a) => ({
		priceCents: toCents(a.price?.value),
	}));
	const market = summarizeMarket(
		{ sold: observations, asks },
		{
			keyword: context.keyword ?? "",
			marketplace: context.marketplace ?? "EBAY_US",
			windowDays: context.windowDays ?? 30,
		},
	);
	return applySeedBlend(market, seed);
}

/**
 * Apply the seed-listing velocity blend to a fresh `MarketStats`. Pulled
 * out so callers that pre-summarised the market (digest builders, the
 * scoring path) can apply the same blend without re-summarising.
 *
 * No-op when the seed is missing data or when the seed rate is below
 * the comp-pool rate. When applied, `salesPerDayBaseline` and
 * `salesPerDaySeed` are populated alongside the new `salesPerDay`.
 *
 * Two responsibilities split for clarity:
 *   - `rollingSoldCount(seed)` — eBay-shape extraction (transform.ts)
 *   - `seedListingRate` + `blendSalesPerDay` — pure math (sales-rate.ts)
 *
 * This function is the thin glue that wires them together.
 */
export function applySeedBlend(market: MarketStats, seed: ItemSummary | ItemDetail | undefined): MarketStats {
	if (!seed) return market;
	const seedRate = seedListingRate(rollingSoldCount(seed), seed.itemCreationDate);
	if (seedRate == null) return market;
	const blended = blendSalesPerDay(market.salesPerDay, seedRate);
	if (blended === market.salesPerDay) {
		// Seed rate computable but ≤ market rate. Surface the seed rate
		// for transparency (UI can still render "this listing alone moved
		// X/day") without rewriting `salesPerDay`.
		return { ...market, salesPerDaySeed: seedRate };
	}
	return {
		...market,
		salesPerDay: blended,
		salesPerDayBaseline: market.salesPerDay,
		salesPerDaySeed: seedRate,
	};
}

/**
 * Days between listing creation and sale (or listing end).
 *   duration = end − start
 *   start    = detail.itemCreationDate
 *   end      = detail.itemEndDate ?? listing.lastSoldDate
 * Returns undefined when either timestamp is missing or unparseable.
 *
 * Relisted-item guard: when the detail's `itemEndDate` is in the future,
 * the seller has relisted the item under the same itemId — eBay's detail
 * endpoint returns the CURRENT live listing's dates, not the historical
 * sold instance's. Trusting those dates produces wildly wrong durations
 * (we saw e.g. detail.creationDate Oct 2025 + detail.endDate May 2026
 * for an item that actually sold Apr 22 in ~5 days). Skip duration for
 * those listings rather than poison the distribution.
 */
function computeDurationDays(listing: ItemSummary, detail: ItemDetail | undefined): number | undefined {
	const detailEndMs = detail?.itemEndDate ? Date.parse(detail.itemEndDate) : NaN;
	const detailIsCurrentLive = Number.isFinite(detailEndMs) && detailEndMs > Date.now();
	// itemCreationDate / itemEndDate are on the summary too (both the sold
	// and active items search paths populate them). Detail wins when present AND
	// not pointing at a relisted instance; the summary fallback unlocks
	// duration math for the common case where the caller hasn't fetched
	// per-listing details.
	const startIso = (!detailIsCurrentLive && detail?.itemCreationDate) || listing.itemCreationDate;
	const endIso = (!detailIsCurrentLive && detail?.itemEndDate) || listing.itemEndDate || listing.lastSoldDate;
	if (!startIso || !endIso) return undefined;
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
	return (end - start) / 86_400_000;
}
