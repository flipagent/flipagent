/**
 * `/v1/evaluate/*` schema — Product/listing intelligence.
 *
 * Composite endpoint: caller passes a `ProductRef` (id / external
 * marketplace listing / free-text query), server resolves to a flipagent
 * Product (auto-creating on miss), runs the cross-marketplace
 * MarketView pipeline, and — when buy-decision context is computable
 * (i.e. ref points to a specific listing with a price) — lays the
 * `evaluation` block on top.
 *
 * Two questions, one surface:
 *   - `evaluation: null`  → "what's this product worth" (the appraise mode)
 *   - `evaluation: {…}`   → "should I buy this listing" (the original evaluate mode)
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemDetail, ItemSummary } from "./ebay/buy.js";
import { Product, ProductRef, ProductVariant } from "./products.js";
import { ForwarderInput } from "./ship.js";

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
		/** Effective rate fed into the queue-model exit forecast. When the
		 *  seed listing's per-listing rate raised this above the comp-pool
		 *  rate, the pre-blend value is preserved on `salesPerDayBaseline`
		 *  and the seed contribution on `salesPerDaySeed`. */
		salesPerDay: Type.Number(),
		/** Comp-pool sales-per-day before seed blending. Set only when
		 *  the seed raised the rate; absent when no blend was applied
		 *  (treat `salesPerDay` as the baseline in that case). */
		salesPerDayBaseline: Type.Optional(Type.Number()),
		/** Seed listing's own per-listing rate
		 *  (`estimatedSoldQuantity / clamp(days_active, 1..60)`). Set when
		 *  the seed had usable `estimatedSoldQuantity` + `itemCreationDate`
		 *  data; surfaces the per-listing demand signal even when it didn't
		 *  end up raising the effective rate. */
		salesPerDaySeed: Type.Optional(Type.Number()),
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

/* ---------------------------- digest shapes ---------------------------- */

/**
 * One bin of a price histogram. `[minCents, maxCents)` (max exclusive
 * except the final bin). Returned as a 10-bin array spanning
 * `priceCents.min` → `priceCents.max` so callers can render the same
 * shape the playground draws — bimodality, long-tail, tight clusters
 * pop out of the bin counts even without a charting library.
 */
export const PriceHistogramBin = Type.Object(
	{
		minCents: Type.Integer(),
		maxCents: Type.Integer(),
		count: Type.Integer(),
	},
	{ $id: "PriceHistogramBin" },
);
export type PriceHistogramBin = Static<typeof PriceHistogramBin>;

/**
 * Full 5-percentile distribution + min/max for a price pool. p10/p90
 * pinpoint the spread; p25/p75 give the IQR; p50 is the median.
 */
export const PriceDistribution = Type.Object(
	{
		minCents: Type.Integer(),
		p10Cents: Type.Integer(),
		p25Cents: Type.Integer(),
		p50Cents: Type.Integer(),
		p75Cents: Type.Integer(),
		p90Cents: Type.Integer(),
		maxCents: Type.Integer(),
	},
	{ $id: "PriceDistribution" },
);
export type PriceDistribution = Static<typeof PriceDistribution>;

/**
 * Trend signal — last 14 days vs the prior 14 days (median price).
 * `null` when the comp set lacks at least 4 sales in either window.
 */
export const RecentTrend = Type.Object(
	{
		direction: Type.Union([Type.Literal("up"), Type.Literal("flat"), Type.Literal("down")]),
		change14dPct: Type.Number(),
	},
	{ $id: "RecentTrend" },
);
export type RecentTrend = Static<typeof RecentTrend>;

/**
 * Condition slug → fraction in [0, 1]. e.g. `{ used_very_good: 0.38,
 * used: 0.47, new: 0.15 }`. Fractions sum to 1.
 */
export const ConditionMix = Type.Record(Type.String(), Type.Number(), { $id: "ConditionMix" });
export type ConditionMix = Static<typeof ConditionMix>;

/**
 * Sold-side digest — distribution + cadence + recent activity. Replaces
 * raw `soldPool` for typical agent flows; the LLM speaks in pattern-level
 * language using these stats. For specific listings, drill into
 * `EvaluatePoolResponse` via `GET /v1/evaluate/{itemId}/pool`.
 */
export const SoldDigest = Type.Object(
	{
		count: Type.Integer(),
		windowDays: Type.Integer(),
		salesPerDay: Type.Number(),
		meanDaysToSell: Type.Union([Type.Number(), Type.Null()]),
		priceCents: PriceDistribution,
		priceHistogram: Type.Array(PriceHistogramBin),
		conditionMix: ConditionMix,
		recentTrend: Type.Union([RecentTrend, Type.Null()]),
		lastSaleAt: Type.Union([Type.String(), Type.Null()]),
		lastSalePriceCents: Type.Union([Type.Integer(), Type.Null()]),
	},
	{ $id: "SoldDigest" },
);
export type SoldDigest = Static<typeof SoldDigest>;

/**
 * Active-side digest — what's currently up for sale, distilled. The
 * `bestPriceCents` field is the floor (cheapest active matching the
 * same-product filter) — the immediate competition. `sellerConcentration`
 * flags markets where 1–2 sellers dominate (suggests price control, less
 * reliable as a comp).
 */
export const ActiveDigest = Type.Object(
	{
		count: Type.Integer(),
		priceCents: PriceDistribution,
		priceHistogram: Type.Array(PriceHistogramBin),
		conditionMix: ConditionMix,
		bestPriceCents: Type.Union([Type.Integer(), Type.Null()]),
		sellerConcentration: Type.Union([Type.Literal("diverse"), Type.Literal("few_sellers")]),
	},
	{ $id: "ActiveDigest" },
);
export type ActiveDigest = Static<typeof ActiveDigest>;

/**
 * Same-product filter outcome. `rejectionsByCategory` is a server-side
 * categorization of the LLM filter's per-item rejection reasons:
 *
 *   - `wrong_product`   different model / mount / version / brand
 *   - `bundle_or_lot`   bundle of multiple items, kit, set
 *   - `off_condition`   broken / for parts / damaged
 *   - `other`           anything the heuristic didn't bucket
 *
 * Counts only — the per-item reason strings live on
 * `EvaluatePoolResponse.{sold,active}.rejected[].rejectionReason`.
 */
export const FilterSummary = Type.Object(
	{
		soldKept: Type.Integer(),
		soldRejected: Type.Integer(),
		activeKept: Type.Integer(),
		activeRejected: Type.Integer(),
		rejectionsByCategory: Type.Record(Type.String(), Type.Integer()),
	},
	{ $id: "FilterSummary" },
);
export type FilterSummary = Static<typeof FilterSummary>;

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
		minNetCents: Type.Optional(Type.Integer({ minimum: 0 })),
		/**
		 * Outbound shipping in cents. When omitted (and no `forwarder` is
		 * provided), defaults to $10 — typical USPS Ground Advantage for
		 * a 1-2lb US domestic box. Caller can override here, or pass a
		 * `forwarder` block for a real landed-cost calc.
		 */
		outboundShippingCents: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ $id: "EvaluateOpts" },
);
export type EvaluateOpts = Static<typeof EvaluateOpts>;

/* ------------------------------ evaluation ------------------------------ */

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
		/**
		 * Gross flip net IF the sale goes through: salePrice − fees − ship − buy.
		 * The "happy path" number — answers "if I sell, what's my margin?"
		 * Doesn't include fraud risk. Null when no recommendation could be
		 * computed (no sold pool / no velocity).
		 */
		successNetCents: Type.Union([Type.Integer(), Type.Null()]),
		/**
		 * True probabilistic expected net per trade:
		 *   E[net] = (1 − P_fraud) × successNet − P_fraud × maxLoss
		 *
		 * This is THE number the rating uses. Folds fraud probability and
		 * worst-case downside into one honest expectation. When P_fraud=0
		 * (no risk data or perfectly safe seller), collapses to successNet.
		 */
		expectedNetCents: Type.Integer(),
		/**
		 * Worst-case downside in cents:
		 *   - cycle fits in return window: just the return shipping cost
		 *   - else: full buy price (item gone, no recovery path)
		 * Null when no recommendation could be computed.
		 */
		maxLossCents: Type.Union([Type.Integer(), Type.Null()]),
		landedCostCents: Type.Union([Type.Integer(), Type.Null()]),
		rating: Type.Union([Type.Literal("buy"), Type.Literal("skip")]),
		/**
		 * Structured rating reason — mutually exclusive enum a UI / programmatic
		 * caller can branch on without parsing `reason` text:
		 *   - `cleared`           — buy passed every gate
		 *   - `vetoed`            — factual veto (broken / parts only / wrong condition)
		 *   - `no_market`         — no sold pool or zero velocity (no exit price)
		 *   - `insufficient_data` — sold pool too small for a confident recommendation
		 *   - `below_min_net`     — expected net below the `minNetCents` threshold
		 */
		reasonCode: Type.Union([
			Type.Literal("cleared"),
			Type.Literal("vetoed"),
			Type.Literal("no_market"),
			Type.Literal("insufficient_data"),
			Type.Literal("below_min_net"),
		]),
		/** Human-readable explanation paired with `reasonCode`. */
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
				/** Mean days-to-sell at `listPriceCents` (Erlang queue model). */
				expectedDaysToSell: Type.Number(),
				/**
				 * Lower / upper edge of ±σ Erlang band, where
				 * σ = √(queueAhead+1) / salesPerDay. The band approximates
				 * a 68% CI: narrow when queue is long (more samples), wide
				 * when queue is short. Floors at 0.5d.
				 */
				daysLow: Type.Number(),
				daysHigh: Type.Number(),
				netCents: Type.Integer(),
				/**
				 * Capital efficiency in cents/day, denominated over the FULL
				 * buy→cash cycle (inbound + list-prep + sell + outbound +
				 * buyer-claim, ~11d of fixed overhead on top of the queue
				 * model's `expectedDaysToSell`). This is what the reseller
				 * actually earns per day of locked capital — list-leg-only
				 * `$/day` would over-credit fast SKUs by ignoring the
				 * non-sell overhead.
				 */
				dollarsPerDay: Type.Integer(),
				/** Realistic asks at or below `listPriceCents`. */
				queueAhead: Type.Integer(),
				/** Realistic asks above `listPriceCents`. */
				asksAbove: Type.Integer(),
			}),
			Type.Null(),
		]),
		/**
		 * Buyer-side risk assessment. Combines seller-feedback signals
		 * (P_fraud) with return-window math (cycle vs window) to produce
		 * a probabilistic worst-case loss the reseller can plan around.
		 * Null when no recommendation could be computed.
		 */
		risk: Type.Union([
			Type.Object({
				/** Probability of fraud / not-as-described / undelivered. */
				P_fraud: Type.Number(),
				/** Cycle (buy → list → sell → return) fits in seller's return window. */
				withinReturnWindow: Type.Boolean(),
				/** Total cycle days used in the window check. */
				cycleDays: Type.Integer(),
				/** Human-readable summary. */
				reason: Type.String(),
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

/* ------------------------------ slices ------------------------------ */

/**
 * Listing-floor surface — pure queue-model output, no buy-cycle math.
 * Buy-decision callers compose net + dollarsPerDay on top using the
 * candidate listing's buy price.
 */
export const ListingFloor = Type.Object(
	{
		listPriceCents: Type.Integer(),
		expectedDaysToSell: Type.Number(),
		daysLow: Type.Number(),
		daysHigh: Type.Number(),
		queueAhead: Type.Integer({ description: "Realistic asks at-or-below the recommended list price." }),
		asksAbove: Type.Integer({ description: "Realistic asks above the recommended list price." }),
	},
	{ $id: "ListingFloor" },
);
export type ListingFloor = Static<typeof ListingFloor>;

/**
 * One condition-tier slice — same shape as the headline trio scoped to
 * listings of one condition tier. Slice keys are eBay-condition
 * normalized for most categories (`new`, `used_like_new`, `used_good`).
 * Graded-card categories augment with grade-aware keys (`graded:psa_9`,
 * `graded:bgs_9.5`) parsed off `conditionDescriptors`.
 */
export const ConditionSlice = Type.Object(
	{
		conditionTier: Type.String(),
		count: Type.Integer(),
		market: MarketStats,
		sold: SoldDigest,
		active: ActiveDigest,
	},
	{ $id: "ConditionSlice" },
);
export type ConditionSlice = Static<typeof ConditionSlice>;

/**
 * Sibling-variant summary. Mini-digest only (median + count + velocity)
 * — enough to render a "size 9 $a · 10 $b · 11 $c" comparison row
 * without shipping every variant's full pool. Cache-only: only variants
 * with a fresh product_market_cache row appear.
 */
export const VariantSummary = Type.Object(
	{
		variantId: Type.String(),
		variantKey: Type.String(),
		attributes: Type.Record(Type.String(), Type.String()),
		count: Type.Integer(),
		medianCents: Type.Union([Type.Integer(), Type.Null()]),
		salesPerDay: Type.Number(),
	},
	{ $id: "VariantSummary" },
);
export type VariantSummary = Static<typeof VariantSummary>;

/* -------------------------------- meta -------------------------------- */

/** What the server fetched, for caller audit + playground trace. */
export const EvaluateMeta = Type.Object(
	{
		/** Same-product sold listings (kept after the LLM filter). Feeds margin math + win-probability. */
		soldCount: Type.Integer(),
		/** Same-product active listings (kept after the LLM filter). Feeds the asks side. */
		activeCount: Type.Integer(),
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
		 * Universal Product reference. Three flavors:
		 *
		 *   - `{ kind: "id", productId, variantId? }` — already-resolved
		 *     flipagent Product
		 *   - `{ kind: "external", marketplace: "ebay_us", listingId }` —
		 *     marketplace listing key (eBay legacy id, full /itm/ URL,
		 *     `v1|<n>|<v>` form all accepted). Resolver fetches detail,
		 *     looks up identifiers, auto-creates Product on miss. The
		 *     buy-decision `evaluation` block is computed against the
		 *     listing's price + seller signals.
		 *   - `{ kind: "query", q, hints? }` — free text. Resolver does
		 *     catalog text search → marketplace anchor → auto-create.
		 *     `evaluation` returns null (no specific listing to score).
		 */
		ref: ProductRef,
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
		/** The flipagent Product the input ref resolved to. */
		product: Product,
		/** Resolved variant when applicable (sized / coloured SKUs); `null` for variant-less products. */
		variant: Type.Union([ProductVariant, Type.Null()]),
		/**
		 * Canonical listing the digest was anchored to — the listing whose
		 * detail seeded the same-product matcher. For `external` ref input
		 * this is the listing being evaluated; for `query` / `id` input
		 * it's the resolver's pick. Detail-level shape so UIs render
		 * thumbnail / title / price without a second fetch.
		 *
		 * `null` when no anchor could be found (rare — only when the
		 * marketplace search came back empty for a query / id resolution).
		 */
		anchor: Type.Union([ItemDetail, Type.Null()]),
		/**
		 * Buy-decision overlay. Computed when the input ref points to a
		 * specific listing with a price (i.e. `ref.kind === "external"`)
		 * AND the resolver successfully returned an anchor. `null` for
		 * `query` / `id` inputs — those callers wanted the market view
		 * only, no specific listing to score.
		 */
		evaluation: Type.Union([Evaluation, Type.Null()]),
		/**
		 * Toggle-view companion to `evaluation` — scored against the full
		 * matched pool (suspicious comps INcluded). The default
		 * `evaluation` is scored against the cleaned pool (suspicious
		 * EXcluded). UI swaps which one drives the headline numbers based
		 * on the "show suspicious" toggle. Same null-when-no-buy-decision
		 * behaviour as `evaluation`.
		 */
		evaluationAll: Type.Union([Evaluation, Type.Null()]),
		/** Distribution stats over `soldPool` minus suspicious comps (median, IQR, salesPerDay, meanDaysToSell, …). */
		market: MarketStats,
		/** Sold-side digest over the cleaned pool: distribution + histogram + cadence + recent trend + condition mix + last-sale anchor. */
		sold: SoldDigest,
		/** Active-side digest over the cleaned pool: distribution + histogram + condition mix + best price + seller concentration. */
		active: ActiveDigest,
		/**
		 * Toggle-view market / sold / active companions, computed from
		 * the FULL matched pool (suspicious INcluded). UI's "show
		 * suspicious" toggle flips between these and the default view.
		 */
		marketAll: Type.Optional(MarketStats),
		soldAll: Type.Optional(SoldDigest),
		activeAll: Type.Optional(ActiveDigest),
		/** Filter summary: kept/rejected counts + categorized rejection reasons. */
		filter: FilterSummary,
		/**
		 * flipagent-derived returns policy summary, parsed from the upstream
		 * `returnTerms` block. `null` when the chosen transport didn't expose
		 * the field (some scrape paths). Lives here, not on the eBay-mirror
		 * `ItemDetail`, so the mirror stays a verbatim mirror.
		 */
		returns: Type.Union([Returns, Type.Null()]),
		/**
		 * Per-condition-tier slices — same shape as the headline trio
		 * scoped to one condition cohort. Always populated; UI decides
		 * whether to render the comparison row.
		 */
		byCondition: Type.Array(ConditionSlice),
		/**
		 * Sibling-variant mini-digests — same product, different variants
		 * (size 9 vs 10 vs 11). Populated cache-only: variants with a
		 * fresh `product_market_cache` row appear; misses are silently
		 * dropped.
		 */
		byVariant: Type.Array(VariantSummary),
		/**
		 * Pure queue-model recommendation — what to ASK for if you sold
		 * one. No buy-cycle math. Buy-decision callers compose net /
		 * dollarsPerDay on top via `evaluation.recommendedExit`. Null when
		 * no exit forecast could be computed (no sold pool, zero velocity).
		 */
		listingFloor: Type.Union([ListingFloor, Type.Null()]),
		/** Condition tier the headline corresponds to — echoed for client clarity. */
		headlineConditionTier: Type.Optional(Type.String()),
		meta: EvaluateMeta,
		/**
		 * Same-product sold listings the evaluation was scored against.
		 * Heavy — kept for back-compat (playground dashboard renders them).
		 * MCP / SDK callers should prefer the `sold` digest above and
		 * call `client.evaluate.pool(itemId)` for drill-down.
		 *
		 * @deprecated Use `sold` digest + `client.evaluate.pool()`.
		 */
		soldPool: Type.Array(ItemSummary),
		/** @deprecated Use `active` digest + `client.evaluate.pool()`. */
		activePool: Type.Array(ItemSummary),
		/** @deprecated Use `filter.rejectionsByCategory` + `client.evaluate.pool()`. */
		rejectedSoldPool: Type.Array(ItemSummary),
		/** @deprecated Use `filter.rejectionsByCategory` + `client.evaluate.pool()`. */
		rejectedActivePool: Type.Array(ItemSummary),
		/** @deprecated Per-item reasons live on `EvaluatePoolResponse.{sold,active}.rejected[].rejectionReason` now. */
		rejectionReasons: Type.Record(Type.String(), Type.String()),
		/**
		 * Per-itemId LLM-emitted rejection bucket — same key set as
		 * `rejectionReasons`, value in
		 * `wrong_product | bundle_or_lot | off_condition | other`.
		 * Read by the drill-down route to populate
		 * `EvaluatePoolResponse.{sold,active}.rejected[].rejectionCategory`.
		 */
		rejectionCategories: Type.Optional(Type.Record(Type.String(), Type.String())),
		/**
		 * Per-itemId map of comps the LLM matched as same-product but the
		 * post-match risk filter (`evaluate/suspicious.ts`) flagged as
		 * likely-fake. Each entry carries a short reason string, the
		 * Bayesian fraud probability, and the buy-price ratio against the
		 * trust-weighted matched-pool median. Default `market` / `sold` /
		 * `active` digests EXCLUDE these; `marketAll` / `soldAll` /
		 * `activeAll` INCLUDE them. UI's "show suspicious" toggle uses
		 * this map to dim flagged rows in the default view and explain
		 * the exclusion on hover.
		 */
		suspiciousIds: Type.Optional(
			Type.Record(
				Type.String(),
				Type.Object({
					reason: Type.String(),
					pFraud: Type.Number(),
				}),
			),
		),
	},
	{ $id: "EvaluateResponse" },
);
export type EvaluateResponse = Static<typeof EvaluateResponse>;

/* ---------------------- GET /v1/evaluate/{itemId}/pool --------------------- */

/**
 * One row in `EvaluatePoolResponse.{sold,active}.kept`. Shape matches
 * `ItemSummary` but trimmed to fields useful for "show me a comparable
 * listing" — title, price, condition, seller, when. Drill-down only;
 * default `EvaluateResponse.sold/active` digests are enough for almost
 * every "should I buy this?" decision.
 */
export const EvaluationPoolItem = Type.Object(
	{
		itemId: Type.String(),
		title: Type.String(),
		priceCents: Type.Integer(),
		currency: Type.String(),
		condition: Type.Optional(Type.String()),
		sellerLogin: Type.Optional(Type.String()),
		itemWebUrl: Type.String({ format: "uri" }),
		soldAt: Type.Optional(Type.String()),
		listedAt: Type.Optional(Type.String()),
	},
	{ $id: "EvaluationPoolItem" },
);
export type EvaluationPoolItem = Static<typeof EvaluationPoolItem>;

export const EvaluationRejectedItem = Type.Object(
	{
		itemId: Type.String(),
		title: Type.String(),
		priceCents: Type.Integer(),
		currency: Type.String(),
		condition: Type.Optional(Type.String()),
		sellerLogin: Type.Optional(Type.String()),
		itemWebUrl: Type.String({ format: "uri" }),
		/** LLM same-product filter's per-item reason. */
		rejectionReason: Type.String(),
		/** Categorized bucket — same enum as `FilterSummary.rejectionsByCategory` keys. */
		rejectionCategory: Type.String(),
	},
	{ $id: "EvaluationRejectedItem" },
);
export type EvaluationRejectedItem = Static<typeof EvaluationRejectedItem>;

/**
 * Drill-down companion to `EvaluateResponse`. Returned by
 * `GET /v1/evaluate/{itemId}/pool` (cache-only — call evaluate first
 * within the cache TTL).
 *
 * Mirrors what the playground reveals when the user clicks "View" on
 * each section: kept + rejected together, rejection reason inline.
 */
export const EvaluatePoolResponse = Type.Object(
	{
		itemId: Type.String(),
		evaluatedAt: Type.String({ format: "date-time" }),
		sold: Type.Object({
			kept: Type.Array(EvaluationPoolItem),
			rejected: Type.Array(EvaluationRejectedItem),
		}),
		active: Type.Object({
			kept: Type.Array(EvaluationPoolItem),
			rejected: Type.Array(EvaluationRejectedItem),
		}),
	},
	{ $id: "EvaluatePoolResponse" },
);
export type EvaluatePoolResponse = Static<typeof EvaluatePoolResponse>;

/* ---------------------- progressive partial (stream mode) ---------------------- */

/**
 * Live progress of the LLM same-product matcher. `processed` items have
 * been classified (kept or rejected); `total` is the dedup'd pool size.
 * Updates roughly per-chunk (TRIAGE_CHUNK = 25) so the UI can render a
 * meaningful progress bar during the slowest pipeline phase.
 */
export const FilterProgress = Type.Object(
	{
		processed: Type.Integer({ minimum: 0 }),
		total: Type.Integer({ minimum: 0 }),
	},
	{ $id: "FilterProgress" },
);
export type FilterProgress = Static<typeof FilterProgress>;

/**
 * Incremental snapshot of an `EvaluateResponse` as it's being assembled
 * by the worker. The server emits typed `partial` events with
 * `Partial<EvaluatePartial>` patches as each pipeline phase produces
 * usable state — `item` after detail, `soldPool` after `search.sold`,
 * `market`/`sold`/`active` first as a *preliminary* pass computed from
 * the raw pool (so the UI can render median/IQR before the LLM filter
 * runs), then again post-filter as confirmed values that also carry
 * `filter` + the rejected pools, and finally `evaluation` once scoring
 * resolves. UIs merge each patch into a `Partial<EvaluatePartial>`
 * state and fade in cards as their data hydrates, replacing the
 * all-or-nothing skeleton.
 */
export const EvaluatePartial = Type.Object(
	{
		product: Type.Optional(Product),
		variant: Type.Optional(Type.Union([ProductVariant, Type.Null()])),
		anchor: Type.Optional(ItemDetail),
		soldPool: Type.Optional(Type.Array(ItemSummary)),
		activePool: Type.Optional(Type.Array(ItemSummary)),
		rejectedSoldPool: Type.Optional(Type.Array(ItemSummary)),
		rejectedActivePool: Type.Optional(Type.Array(ItemSummary)),
		rejectionReasons: Type.Optional(Type.Record(Type.String(), Type.String())),
		rejectionCategories: Type.Optional(Type.Record(Type.String(), Type.String())),
		market: Type.Optional(MarketStats),
		sold: Type.Optional(SoldDigest),
		active: Type.Optional(ActiveDigest),
		/**
		 * Toggle-view companions to `market` / `sold` / `active`. Computed
		 * from the FULL matched pool (suspicious comps included) so the
		 * UI's "show suspicious" switch can swap which set drives the
		 * headline numbers without a server roundtrip. Default-view
		 * `market`/`sold`/`active` exclude the suspicious comps listed in
		 * `suspiciousIds`.
		 */
		marketAll: Type.Optional(MarketStats),
		soldAll: Type.Optional(SoldDigest),
		activeAll: Type.Optional(ActiveDigest),
		filter: Type.Optional(FilterSummary),
		filterProgress: Type.Optional(FilterProgress),
		returns: Type.Optional(Type.Union([Returns, Type.Null()])),
		byCondition: Type.Optional(Type.Array(ConditionSlice)),
		byVariant: Type.Optional(Type.Array(VariantSummary)),
		listingFloor: Type.Optional(Type.Union([ListingFloor, Type.Null()])),
		headlineConditionTier: Type.Optional(Type.String()),
		meta: Type.Optional(EvaluateMeta),
		/** Buy-decision overlay — null when ref didn't carry a specific buy listing. */
		evaluation: Type.Optional(Type.Union([Evaluation, Type.Null()])),
		evaluationAll: Type.Optional(Type.Union([Evaluation, Type.Null()])),
		/**
		 * Per-itemId map of comps the LLM matched as same-product but the
		 * post-match risk filter (`evaluate/suspicious.ts`) flagged as
		 * likely-fake (Bayesian P_fraud > 0.4 from `quant.assessRisk`).
		 * Default `market` / `sold` / `active` digests exclude these;
		 * `marketAll` / `soldAll` / `activeAll` include them. UI dims
		 * flagged rows in the default view and exposes the toggle to
		 * unhide them.
		 */
		suspiciousIds: Type.Optional(
			Type.Record(
				Type.String(),
				Type.Object({
					reason: Type.String(),
					/** Bayesian fraud probability from `quant.assessRisk`. 0..0.85. */
					pFraud: Type.Number(),
				}),
			),
		),
		/**
		 * True while `market` / `sold` / `active` are computed from the raw
		 * pool (pre-LLM-filter). UIs render those values in a "verifying"
		 * style so users know the numbers will sharpen once the filter
		 * removes off-product comps.
		 */
		preliminary: Type.Optional(Type.Boolean()),
	},
	{ $id: "EvaluatePartial" },
);
export type EvaluatePartial = Static<typeof EvaluatePartial>;

/* ---------------------- compute-job shape (async mode) ---------------------- */

import { ComputeJobBase } from "./compute-jobs.js";

/**
 * `GET /v1/evaluate/jobs/{id}` body. `params` echoes the request that
 * created the job so reload UI doesn't need separate state. `result`
 * is present iff `status === "completed"`. `partial` is the merged
 * `EvaluatePartial` accumulated from every `partial` event the worker
 * has emitted so far — non-null once at least one phase has produced
 * state (typically the `detail` step within ~1s of dispatch). Lets
 * MCP / SDK polling consumers render progressive UI without
 * subscribing to the SSE stream.
 */
export const EvaluateJob = Type.Intersect(
	[
		ComputeJobBase,
		Type.Object({
			kind: Type.Literal("evaluate"),
			params: EvaluateRequest,
			result: Type.Union([EvaluateResponse, Type.Null()]),
			partial: Type.Union([EvaluatePartial, Type.Null()]),
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
