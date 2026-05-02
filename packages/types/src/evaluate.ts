/**
 * `/v1/evaluate/*` schema — id-driven single-listing judgment.
 *
 * Composite endpoint: caller passes `itemId`, the server fetches the
 * detail, searches sold + active listings of the same product, runs
 * the LLM same-product filter, and scores.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemDetail, ItemSummary } from "./ebay/buy.js";
import { ForwarderInput } from "./ship.js";

/* ----------------------------- shared meta ----------------------------- */

/** Transport that served an upstream lookup. Mirrors `services/items/search`. */
export const TransportSource = Type.Union([Type.Literal("rest"), Type.Literal("scrape"), Type.Literal("bridge")], {
	$id: "TransportSource",
});
export type TransportSource = Static<typeof TransportSource>;

/* ----------------------------- market stats ----------------------------- */

export const AskStats = Type.Object(
	{
		meanCents: Type.Integer(),
		stdDevCents: Type.Integer(),
		medianCents: Type.Integer(),
		p25Cents: Type.Integer(),
		p75Cents: Type.Integer(),
		nActive: Type.Integer(),
	},
	{ $id: "AskStats" },
);
export type AskStats = Static<typeof AskStats>;

/**
 * Aggregated stats over the same-product sold pool the evaluation was
 * scored against. Surfaced in `EvaluateResponse` so callers can render
 * "median $X · IQR $A–$B · n=42 · sells 1.2/day · ~14d typical wait"
 * without re-deriving the math client-side.
 */
export const MarketStats = Type.Object(
	{
		keyword: Type.String(),
		marketplace: Type.String(),
		windowDays: Type.Integer(),
		meanCents: Type.Integer(),
		stdDevCents: Type.Integer(),
		medianCents: Type.Integer(),
		medianCiLowCents: Type.Optional(Type.Integer()),
		medianCiHighCents: Type.Optional(Type.Integer()),
		p25Cents: Type.Integer(),
		p75Cents: Type.Integer(),
		nObservations: Type.Integer(),
		salesPerDay: Type.Number(),
		meanDaysToSell: Type.Optional(Type.Number()),
		daysStdDev: Type.Optional(Type.Number()),
		daysP50: Type.Optional(Type.Number()),
		daysP70: Type.Optional(Type.Number()),
		daysP90: Type.Optional(Type.Number()),
		nDurations: Type.Optional(Type.Integer()),
		asks: Type.Optional(AskStats),
		asOf: Type.String(),
	},
	{ $id: "MarketStats" },
);
export type MarketStats = Static<typeof MarketStats>;

/* ------------------------------- options ------------------------------- */

/**
 * Public tunables for `/v1/evaluate`. The sold + active pools are not
 * part of the public surface — the composite endpoint derives them
 * server-side. The internal service-layer options
 * (`packages/api/src/services/evaluate/types.ts`) carry the pools for
 * the underlying `evaluate()` function.
 */
export const EvaluateOpts = Type.Object(
	{
		forwarder: Type.Optional(ForwarderInput),
		expectedSaleMultiplier: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
		minNetCents: Type.Optional(Type.Integer({ minimum: 0 })),
		minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
		/**
		 * Outbound shipping in cents. When omitted (and no `forwarder` is
		 * provided), defaults to $10 — typical USPS Ground Advantage for
		 * a 1-2lb US domestic box. Caller can override here, or pass a
		 * `forwarder` block for a real landed-cost calc.
		 */
		outboundShippingCents: Type.Optional(Type.Integer({ minimum: 0 })),
		/**
		 * Hard ceiling on expected-days-to-sell when picking the recommended
		 * exit. Honours the user's "Sell within X days" filter — prices
		 * whose predicted hold exceeds this are excluded from the grid.
		 * When the feasible set is empty, `recommendedExit` is null.
		 */
		maxDaysToSell: Type.Optional(Type.Number({ minimum: 1 })),
		/**
		 * Override hazard elasticity β. When omitted, derived from the
		 * listing's `categoryId` (per-category default) or 1.5 fallback.
		 */
		beta: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
	},
	{ $id: "EvaluateOpts" },
);
export type EvaluateOpts = Static<typeof EvaluateOpts>;

/* ------------------------------ evaluation ------------------------------ */

export const FiredSignal = Type.Object(
	{
		name: Type.String(),
		weight: Type.Number(),
		reason: Type.String(),
	},
	{ $id: "FiredSignal" },
);
export type FiredSignal = Static<typeof FiredSignal>;

/**
 * p10/p90 of expected net (cents) across the IQR-cleaned sold pool.
 * Same input distribution as `expectedNetCents` (the mean) — the band
 * is the downside/upside if the sold prices repeat. Null when fewer
 * than 4 sold listings.
 */
export const NetRangeCents = Type.Object(
	{
		p10Cents: Type.Integer(),
		p90Cents: Type.Integer(),
	},
	{ $id: "NetRangeCents" },
);
export type NetRangeCents = Static<typeof NetRangeCents>;

export const Evaluation = Type.Object(
	{
		expectedNetCents: Type.Integer(),
		confidence: Type.Number(),
		landedCostCents: Type.Union([Type.Integer(), Type.Null()]),
		signals: Type.Array(FiredSignal),
		rating: Type.Union([Type.Literal("buy"), Type.Literal("hold"), Type.Literal("skip")]),
		reason: Type.String(),
		bidCeilingCents: Type.Union([Type.Integer(), Type.Null()]),
		safeBidBreakdown: Type.Union([
			Type.Object({
				estimatedSaleCents: Type.Integer(),
				feesCents: Type.Integer(),
				shippingCents: Type.Integer(),
				targetNetCents: Type.Integer(),
			}),
			Type.Null(),
		]),
		netRangeCents: Type.Union([NetRangeCents, Type.Null()]),
		recommendedExit: Type.Union([
			Type.Object({
				listPriceCents: Type.Integer(),
				expectedDaysToSell: Type.Number(),
				/**
				 * Probability of sale within 7 / 14 / 30 days under the
				 * MNL hazard model. Together with `expectedDaysToSell`
				 * they describe the predicted distribution rather than a
				 * single point — useful for callers that want to surface
				 * "70% in 7d, 95% in 30d" alongside the mean. Values
				 * are in [0, 1]; rounded for display by clients.
				 */
				sellProb7d: Type.Number(),
				sellProb14d: Type.Number(),
				sellProb30d: Type.Number(),
				netCents: Type.Integer(),
				dollarsPerDay: Type.Integer(),
			}),
			Type.Null(),
		]),
	},
	{ $id: "Evaluation" },
);
export type Evaluation = Static<typeof Evaluation>;

/* ----------------------------- returns ----------------------------- */

/**
 * Returns policy for the listing — flipagent-derived from eBay's
 * `returnTerms` block on the item detail. Surfaced on `EvaluateResponse`
 * (NOT on the eBay-mirror `ItemDetail`) so the trust-signal display in
 * UI clients doesn't require parsing the upstream block themselves.
 *
 * `null` when the upstream source didn't expose returns info (e.g. some
 * scrape paths) — UIs render this as "—" rather than asserting "no returns".
 */
export const Returns = Type.Object(
	{
		/** True iff the seller accepts returns. */
		accepted: Type.Boolean(),
		/** Return window in days (eBay's `returnPeriod.value` when unit=DAY). Omitted when unknown. */
		periodDays: Type.Optional(Type.Integer({ minimum: 0 })),
		/** "BUYER" | "SELLER" — who pays return shipping. Omitted when not surfaced. */
		shippingCostPaidBy: Type.Optional(Type.Union([Type.Literal("BUYER"), Type.Literal("SELLER")])),
	},
	{ $id: "Returns" },
);
export type Returns = Static<typeof Returns>;

/* -------------------------------- meta -------------------------------- */

/** What the server fetched, for caller audit + playground trace. */
export const EvaluateMeta = Type.Object(
	{
		itemSource: TransportSource,
		/** Same-product sold listings (kept after the LLM filter). Feeds margin math + win-probability. */
		soldCount: Type.Integer(),
		/** Source the sold pool came from. Null when the sold search failed (active still ran). */
		soldSource: Type.Union([TransportSource, Type.Null()]),
		/** Same-product active listings (kept after the LLM filter). Feeds the asks side. */
		activeCount: Type.Integer(),
		/** Source the active pool came from. Null when the active search failed (sold still ran). */
		activeSource: Type.Union([TransportSource, Type.Null()]),
		/** LLM filter outcome (rejected = different product). Useful for showing "12 kept / 8 rejected" in a trace. */
		soldKept: Type.Integer(),
		soldRejected: Type.Integer(),
		activeKept: Type.Integer(),
		activeRejected: Type.Integer(),
	},
	{ $id: "EvaluateMeta" },
);
export type EvaluateMeta = Static<typeof EvaluateMeta>;

/* ---------------------------- POST /v1/evaluate ---------------------------- */

export const EvaluateRequest = Type.Object(
	{
		/**
		 * eBay item id. Accepts:
		 *
		 *   - `v1|<legacy>|0`           — parent (no variation)
		 *   - `v1|<legacy>|<variationId>` — specific SKU of a multi-variation listing
		 *   - bare legacy numeric         — same as `v1|<n>|0`
		 *   - full eBay URL               — `https://www.ebay.com/itm/<n>?var=<v>`,
		 *                                   variation honored when present
		 *
		 * For multi-SKU listings (sneakers, clothes, bags) pass the variation
		 * form so the detail fetch pulls the right SKU's price + aspects.
		 * Without it eBay default-renders one variation server-side, which
		 * gives evaluate the wrong listing-side price.
		 */
		itemId: Type.String({ minLength: 1 }),
		/**
		 * Sold-search lookback window in days. Filters the sold pool to
		 * `lastSoldDate within [now - lookbackDays, now]`. Default 90 (eBay
		 * Marketplace Insights' practical max). Lower it for fast-moving
		 * markets where 90-day sold means anchored to stale prices.
		 */
		lookbackDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
		/**
		 * Cap on sold-search results before LLM same-product filtering.
		 * Default 50 — the size at which IQR cleaning + percentile
		 * estimates stabilise. Max 200 (eBay Browse page cap).
		 */
		soldLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		opts: Type.Optional(EvaluateOpts),
	},
	{ $id: "EvaluateRequest" },
);
export type EvaluateRequest = Static<typeof EvaluateRequest>;

export const EvaluateResponse = Type.Object(
	{
		/** The fetched item detail — surfaced so UIs can render thumbnail/title/price without a second fetch. */
		item: ItemDetail,
		/** Same-product sold listings the evaluation was scored against. */
		soldPool: Type.Array(ItemSummary),
		/** Same-product active listings (asks). */
		activePool: Type.Array(ItemSummary),
		/** Sold listings the same-product filter rejected (different product). Empty when the LLM didn't run. UIs can render side-by-side with the matched pool to expose the filter's judgement. */
		rejectedSoldPool: Type.Array(ItemSummary),
		/** Active listings the same-product filter rejected. Same purpose as `rejectedSoldPool` but on the asks side. */
		rejectedActivePool: Type.Array(ItemSummary),
		/**
		 * Per-itemId LLM reason string for every rejected listing — keyed
		 * by `ItemSummary.itemId` of items in `rejectedSoldPool` ∪
		 * `rejectedActivePool`. Empty object when the LLM filter didn't
		 * run (no provider configured) or when nothing was rejected. UIs
		 * surface these as audit text under each rejected row so the
		 * matcher's judgement is legible.
		 */
		rejectionReasons: Type.Record(Type.String(), Type.String()),
		/** Distribution stats over `soldPool` (median, IQR, salesPerDay, meanDaysToSell, …). */
		market: MarketStats,
		evaluation: Evaluation,
		/**
		 * flipagent-derived returns policy summary, parsed from the upstream
		 * `returnTerms` block. `null` when the chosen transport didn't expose
		 * the field (some scrape paths). Lives here, not on the eBay-mirror
		 * `ItemDetail`, so the mirror stays a verbatim mirror.
		 */
		returns: Type.Union([Returns, Type.Null()]),
		meta: EvaluateMeta,
	},
	{ $id: "EvaluateResponse" },
);
export type EvaluateResponse = Static<typeof EvaluateResponse>;

/* ---------------------- compute-job shape (async mode) ---------------------- */

import { ComputeJobBase } from "./compute-jobs.js";

/**
 * `GET /v1/evaluate/jobs/{id}` body. `params` echoes the request that
 * created the job so reload UI doesn't need separate state. `result` is
 * present iff `status === "completed"`.
 */
export const EvaluateJob = Type.Intersect(
	[
		ComputeJobBase,
		Type.Object({
			kind: Type.Literal("evaluate"),
			params: EvaluateRequest,
			result: Type.Union([EvaluateResponse, Type.Null()]),
		}),
	],
	{ $id: "EvaluateJob" },
);
export type EvaluateJob = Static<typeof EvaluateJob>;

/* ---------------------- featured (showcase) ---------------------- */

/**
 * One row in the platform-wide "Try one" showcase. Sourced from real
 * recent successful evaluate jobs (any user) that have meaningful sold
 * depth. Exposed verbatim with `itemWebUrl` so click-through stays
 * ToS-compliant; takedown'd itemIds are excluded server-side.
 */
export const FeaturedEvaluation = Type.Object(
	{
		itemId: Type.String(),
		title: Type.String(),
		itemWebUrl: Type.String({ format: "uri" }),
		image: Type.Optional(Type.String({ format: "uri" })),
		/** ISO timestamp of the underlying compute job's completion. */
		completedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "FeaturedEvaluation" },
);
export type FeaturedEvaluation = Static<typeof FeaturedEvaluation>;

export const FeaturedEvaluationsResponse = Type.Object(
	{
		items: Type.Array(FeaturedEvaluation),
	},
	{ $id: "FeaturedEvaluationsResponse" },
);
export type FeaturedEvaluationsResponse = Static<typeof FeaturedEvaluationsResponse>;
