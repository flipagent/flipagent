/**
 * Public types for the scoring layer. Output shapes mirror the wire
 * contracts in `@flipagent/types` so route handlers can pass
 * service results through verbatim. Input shapes lean on
 * `@flipagent/types/ebay` so callers can pipe Browse / Marketplace
 * Insights results in without converters.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import type { ListPriceAdvice, MarketStats } from "../quant/index.js";

/** Anything we can evaluate. Search results give ItemSummary; detail fetches give ItemDetail. */
export type Listing = ItemSummary | ItemDetail;

/** A signal detector that fired on a listing, with the human-readable reason. */
export type SignalHit = {
	name: string;
	weight: number;
	reason: string;
};

/** p10/p90 of expected net (cents) over the IQR-cleaned comp cohort. */
export type NetRangeCents = { p10Cents: number; p90Cents: number };

/** Verdict returned by `evaluate`. All money fields are cents-denominated integers. */
export type DealVerdict = {
	isDeal: boolean;
	/** Expected net take-home in cents (= quant Score.netCents). Mean over the comp cohort. */
	netCents: number;
	/** 0..1 — combination of seller trust, image count, comp count, listing freshness. */
	confidence: number;
	/** Total delivered cost to the destination, or null if no destination state was supplied. */
	landedCostCents: number | null;
	signals: ReadonlyArray<SignalHit>;
	/** Bottom-line rating: "buy" | "watch" | "skip". */
	rating: "buy" | "watch" | "skip";
	/** Human-readable explanation of the rating. */
	reason: string;
	/**
	 * Max purchase price (cents) at which expected net ≥ `minNetCents`. Inverse
	 * of the mean — the "pay no more than this" ceiling for the trade to clear.
	 * Null when no comps (no market mean to invert).
	 */
	bidCeilingCents: number | null;
	/**
	 * Cost components behind `bidCeilingCents`, surfaced so the UI can
	 * render `$ceiling = $sale − $fees − $ship − $targetNet`. Null when
	 * the ceiling itself is null (no comps / market mean = 0).
	 */
	safeBidBreakdown: {
		estimatedSaleCents: number;
		feesCents: number;
		shippingCents: number;
		targetNetCents: number;
	} | null;
	/**
	 * P(net > 0) over the empirical sold-price distribution, conditional on
	 * sale. Null when fewer than 4 comps to estimate from.
	 */
	probProfit: number | null;
	/** Risk band on net. Null when fewer than 4 comps. */
	netRangeCents: NetRangeCents | null;
	/**
	 * One-shot exit plan: list at this price → sells in this many days →
	 * net (after subtracting buy cost). The "answer" the caller should
	 * surface to a reseller. Derived from the same hazard model + competition
	 * factor that drives `optimalListPrice`, then with the buy cost
	 * subtracted so the net is true flipping profit.
	 *
	 * Null when comps lack duration data (no time-to-sell model) or no
	 * profitable price exists (verdict will be `skip`).
	 */
	recommendedExit: {
		listPriceCents: number;
		expectedDays: number;
		netCents: number;
		dollarsPerDay: number;
	} | null;
};

/** Forwarder leg input — cents/grams and US state, matching `services/forwarder`. */
export type ForwarderInput = {
	/** US state code, e.g. "NY". Required to bill the forwarder leg. */
	destState: string;
	/** Package weight in grams. Drives rate banding + dim-weight resolution. */
	weightG: number;
	/** Optional bounding-box dims in cm for dim-weight billing. */
	dimsCm?: { l: number; w: number; h: number };
	/** Forwarder provider id. Default `"planet-express"`. */
	provider?: string;
	/** Number of items being consolidated. Default 1. */
	itemCount?: number;
};

/**
 * Bundle returned by `thesis(comps, asks?, context?)`. Distribution stats
 * + EV-optimal list price (when comps carry duration data).
 */
export type ResearchThesis = {
	market: MarketStats;
	listPriceAdvice: ListPriceAdvice | null;
};

/** Output of `draft(item, market, opts?)`. */
export type DraftRecommendation = {
	titleSuggestion: string;
	listPriceAdvice: ListPriceAdvice | null;
	reason: string;
};

/** Caller-supplied state for `reprice`. */
export type RepriceStateInput = {
	currentPriceCents: number;
	listedAt: string | Date;
};

/** Output of `reprice(market, state)`. */
export type RepriceRecommendation = {
	action: "hold" | "drop" | "delist";
	daysListed: number;
	suggestedPriceCents?: number;
	reason: string;
};

/** Tunables shared by `evaluate`, `find`, and `signalsFor`. */
export type EvaluateOptions = {
	/** Sold comparables. Required for margin + signal math. */
	comps?: ReadonlyArray<ItemSummary>;
	/**
	 * Currently-active competing listings (ask-side). Feeds two things:
	 * (1) the `belowAsks` buy-signal in scoring, (2) the position-aware
	 * competition factor + active-median blend in `optimalListPrice`.
	 * Without asks, hazard math falls back to sold-only — fine for cold
	 * markets but weaker when the live market has moved relative to the
	 * 90-day sold window.
	 */
	asks?: ReadonlyArray<ItemSummary>;
	/** Forwarder leg input. When set, `landedCostCents` is computed; otherwise null. */
	forwarder?: ForwarderInput;
	/** Re-list price as a fraction of market median. Default 0.95. */
	saleMultiplier?: number;
	/** Net-margin threshold under which a deal is "skip". Default 3000 cents ($30). */
	minNetCents?: number;
	/** Confidence threshold under which a deal is "watch" not "buy". Default 0.4. */
	minConfidence?: number;
	/** Liquidity floor: minimum salesPerDay to consider buying. Default 0.5. */
	minSalesPerDay?: number;
	/**
	 * Outbound shipping in cents. Defaults to $10 (USPS Ground Advantage
	 * 1-2lb US domestic) when neither this nor `forwarder` is supplied.
	 * Used in both the bidCeiling math and the per-comp net distribution.
	 */
	outboundShippingCents?: number;
	/**
	 * Hard ceiling on expected-days-to-sell when picking the recommended
	 * exit. Honour the user's "Sell within X days" filter — prices whose
	 * predicted hold exceeds this are excluded from the grid. When the
	 * feasible set is empty, `recommendedExit` is null and the verdict
	 * surfaces a "no exit within window" reason.
	 */
	maxDaysToSell?: number;
	/**
	 * Override hazard elasticity β. Default 1.5; per-category map applied
	 * automatically when `categoryId` is present on the listing.
	 */
	beta?: number;
};
