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
		forwarder: Type.Optional(ForwarderInput),
		saleMultiplier: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
		minNetCents: Type.Optional(Type.Integer({ minimum: 0 })),
		minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
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
		 * P(net > 0) under the empirical sold-price distribution. 0..1.
		 * Null when fewer than 4 comps to estimate from.
		 */
		probProfit: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
		/** Risk band — null when fewer than 4 comps. */
		netRangeCents: Type.Union([NetRangeCents, Type.Null()]),
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
