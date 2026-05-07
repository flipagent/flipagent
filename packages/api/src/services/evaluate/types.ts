/**
 * Internal-only types for the scoring layer. Wire types
 * (`Evaluation`, `NetRangeCents`, `ForwarderInput`) are imported from
 * `@flipagent/types` so a route handler can pass service results into
 * `c.json(...)` verbatim — no parallel definitions, no drift. Anything
 * that's *not* on the wire (matcher-style options, union helpers)
 * lives here.
 */

import type { ForwarderInput } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";

// Re-export wire types so service modules can keep importing from
// `./types.js` without reaching into `@flipagent/types` directly.
export type { Evaluation, ForwarderInput, NetRangeCents } from "@flipagent/types";

/** Anything we can evaluate. Search results give ItemSummary; detail fetches give ItemDetail. */
export type EvaluableItem = ItemSummary | ItemDetail;

/** Tunables shared by `evaluate` and `rankCandidates`. */
export interface EvaluateOptions {
	/** Sold listings (the price-reference pool). Required for margin math. */
	sold?: ReadonlyArray<ItemSummary>;
	/**
	 * Currently-active competing listings (ask-side). Feeds the
	 * cooling-drift detection and the queue-position calculation in
	 * `recommendListPrice`. Without asks, recommendation falls back to
	 * the sold reference with no competitor info.
	 */
	asks?: ReadonlyArray<ItemSummary>;
	/** Forwarder leg input. When set, `landedCostCents` is computed; otherwise null. */
	forwarder?: ForwarderInput;
	/** Risk-adjusted net threshold under which a deal is "skip".
	 *  Default 0 — any positive expected net clears. Pass a stricter
	 *  floor when the caller has a time/effort cutoff in mind. */
	minNetCents?: number;
	/**
	 * Outbound shipping in cents. Defaults to $10 (USPS Ground Advantage
	 * 1-2lb US domestic) when neither this nor `forwarder` is supplied.
	 * Used in both the bidCeiling math and the per-listing net distribution.
	 */
	outboundShippingCents?: number;
	/**
	 * Window (days) the `sold` pool was fetched for. Surfaced into
	 * `MarketStats.windowDays`, which the recency-weighted velocity
	 * estimator uses to normalize. Default 30 — match this to your
	 * Marketplace Insights `filter` so old sales aren't decayed to zero.
	 */
	lookbackDays?: number;
}
