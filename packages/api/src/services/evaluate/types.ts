/**
 * Internal-only types for the scoring layer. Wire types
 * (`Evaluation`, `FiredSignal`, `NetRangeCents`, `ForwarderInput`) are
 * imported from `@flipagent/types` so a route handler can pass service
 * results into `c.json(...)` verbatim — no parallel definitions, no
 * drift. Anything that's *not* on the wire (matcher-style options,
 * union helpers) lives here.
 */

import type { ForwarderInput } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";

// Re-export wire types so service modules can keep importing from
// `./types.js` without reaching into `@flipagent/types` directly.
export type { Evaluation, FiredSignal, ForwarderInput, NetRangeCents } from "@flipagent/types";

/** Anything we can evaluate. Search results give ItemSummary; detail fetches give ItemDetail. */
export type EvaluableItem = ItemSummary | ItemDetail;

/** Tunables shared by `evaluate` and `rankCandidates`. */
export interface EvaluateOptions {
	/** Sold listings (the price-reference pool). Required for margin + signal math. */
	sold?: ReadonlyArray<ItemSummary>;
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
	expectedSaleMultiplier?: number;
	/** Net-margin threshold under which a deal is "skip". Default 3000 cents ($30). */
	minNetCents?: number;
	/** Confidence threshold under which a deal is "hold" not "buy". Default 0.4. */
	minConfidence?: number;
	/** Liquidity floor: minimum salesPerDay to consider buying. Default 0.5. */
	minSalesPerDay?: number;
	/**
	 * Outbound shipping in cents. Defaults to $10 (USPS Ground Advantage
	 * 1-2lb US domestic) when neither this nor `forwarder` is supplied.
	 * Used in both the bidCeiling math and the per-listing net distribution.
	 */
	outboundShippingCents?: number;
	/**
	 * Hard ceiling on expected-days-to-sell when picking the recommended
	 * exit. Honour the user's "Sell within X days" filter — prices whose
	 * predicted hold exceeds this are excluded from the grid. When the
	 * feasible set is empty, `recommendedExit` is null and the evaluation
	 * surfaces a "no exit within window" reason.
	 */
	maxDaysToSell?: number;
	/**
	 * Override hazard elasticity β. Default 1.5; per-category map applied
	 * automatically when `categoryId` is present on the listing.
	 */
	beta?: number;
}
