/**
 * `/v1/evaluate/*` schemas — single-listing judgment. Decisions pillar.
 * `EvaluateOptions` is re-used by `/v1/discover` (same tunables apply
 * to the batch ranking).
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemSummary } from "./ebay/buy.js";
import { ForwarderInput, Listing } from "./ship.js";

/* ------------------------------- options ------------------------------- */

export const EvaluateOptions = Type.Object(
	{
		comps: Type.Optional(Type.Array(ItemSummary)),
		/**
		 * Currently-active competing listings. Feeds the `belowAsks` signal
		 * + the position-aware competition factor + sold-mean vs active-median
		 * blend in the recommended-exit search. Without asks, the recommended
		 * exit falls back to sold-only hazard (correct for cold markets but
		 * weak when the live market has moved relative to the 90-day sold
		 * window).
		 */
		asks: Type.Optional(Type.Array(ItemSummary)),
		forwarder: Type.Optional(ForwarderInput),
		saleMultiplier: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
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
	{ $id: "EvaluateOptions" },
);
export type EvaluateOptions = Static<typeof EvaluateOptions>;

/* ------------------------------- verdict ------------------------------- */

export const SignalHit = Type.Object(
	{
		name: Type.String(),
		weight: Type.Number(),
		reason: Type.String(),
	},
	{ $id: "SignalHit" },
);
export type SignalHit = Static<typeof SignalHit>;

/**
 * p10/p90 of expected net (cents) across the IQR-cleaned comp cohort.
 * Same input distribution as `netCents` (the mean) — the band is the
 * downside/upside if the comps repeat. Null when fewer than 4 comps.
 */
export const NetRangeCents = Type.Object(
	{
		p10Cents: Type.Integer(),
		p90Cents: Type.Integer(),
	},
	{ $id: "NetRangeCents" },
);
export type NetRangeCents = Static<typeof NetRangeCents>;

export const DealVerdict = Type.Object(
	{
		isDeal: Type.Boolean(),
		netCents: Type.Integer(),
		confidence: Type.Number(),
		landedCostCents: Type.Union([Type.Integer(), Type.Null()]),
		signals: Type.Array(SignalHit),
		rating: Type.Union([Type.Literal("buy"), Type.Literal("watch"), Type.Literal("skip")]),
		reason: Type.String(),
		/**
		 * Max purchase price (cents) at which expected net ≥ `minNetCents`.
		 * Inverse of the mean — "pay no more than this and the trade still
		 * clears your margin floor." Null when comps absent (no market).
		 */
		bidCeilingCents: Type.Union([Type.Integer(), Type.Null()]),
		/**
		 * Cost components behind `bidCeilingCents` so callers can render
		 * "$ceiling = $sale − $fees − $ship − $targetNet" without re-
		 * deriving the fee constants. Null when bidCeiling is null.
		 */
		safeBidBreakdown: Type.Union([
			Type.Object({
				estimatedSaleCents: Type.Integer(),
				feesCents: Type.Integer(),
				shippingCents: Type.Integer(),
				targetNetCents: Type.Integer(),
			}),
			Type.Null(),
		]),
		/**
		 * P(net > 0) under the empirical sold-price distribution. 0..1.
		 * Null when fewer than 4 comps to estimate from.
		 */
		probProfit: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
		/** Risk band — null when fewer than 4 comps. */
		netRangeCents: Type.Union([NetRangeCents, Type.Null()]),
		/**
		 * One-shot exit plan for buyers: list at this price → expected to
		 * sell in this many days → profit (after fees, shipping, AND buy
		 * cost). The "answer" the playground surfaces. Derived from the
		 * full hazard model + competition factor (active asks) + sold-mean
		 * vs active-median blend. Null when comps lack duration data or no
		 * profitable price clears within the search grid.
		 */
		recommendedExit: Type.Union([
			Type.Object({
				listPriceCents: Type.Integer(),
				expectedDays: Type.Number(),
				netCents: Type.Integer(),
				dollarsPerDay: Type.Integer(),
			}),
			Type.Null(),
		]),
	},
	{ $id: "DealVerdict" },
);
export type DealVerdict = Static<typeof DealVerdict>;

/* ---------------------------- POST /v1/evaluate ---------------------------- */

export const EvaluateRequest = Type.Object(
	{
		item: Listing,
		opts: Type.Optional(EvaluateOptions),
	},
	{ $id: "EvaluateRequest" },
);
export type EvaluateRequest = Static<typeof EvaluateRequest>;

export const EvaluateResponse = DealVerdict;
export type EvaluateResponse = DealVerdict;

/* ------------------------ POST /v1/evaluate/signals ------------------------ */

export const EvaluateSignalsRequest = Type.Object(
	{
		item: ItemSummary,
		comps: Type.Optional(Type.Array(ItemSummary)),
	},
	{ $id: "EvaluateSignalsRequest" },
);
export type EvaluateSignalsRequest = Static<typeof EvaluateSignalsRequest>;

export const EvaluateSignalsResponse = Type.Object(
	{
		signals: Type.Array(SignalHit),
	},
	{ $id: "EvaluateSignalsResponse" },
);
export type EvaluateSignalsResponse = Static<typeof EvaluateSignalsResponse>;
