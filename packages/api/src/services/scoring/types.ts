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
	 * P(net > 0) over the empirical sold-price distribution, conditional on
	 * sale. Null when fewer than 4 comps to estimate from.
	 */
	probProfit: number | null;
	/** Risk band on net. Null when fewer than 4 comps. */
	netRangeCents: NetRangeCents | null;
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
};
