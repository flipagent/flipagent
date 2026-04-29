/**
 * `/v1/research/*` schemas — market summary + recovery probability.
 * Aggregates sold-side stats (and optionally active asks) into a single
 * bundle the agent can pass to `/v1/draft`, `/v1/reprice`, and
 * `/v1/discover` without re-fetching comparables for every call.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemSummary } from "./ebay/buy.js";

/**
 * Active-side stats. Distribution of currently-listed prices for the
 * same SKU/marketplace as the sold-side `MarketStats`.
 */
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
 * Aggregated sold-price stats for a keyword + marketplace + window.
 * Mean is the probability-weighted expectation of sale price under
 * the empirical distribution. `meanDaysToSell` populates only when at
 * least one comparable carried duration data; `asks` populates only when
 * the caller passed active listings.
 */
export const MarketStats = Type.Object(
	{
		keyword: Type.String(),
		marketplace: Type.String(),
		windowDays: Type.Integer(),
		meanCents: Type.Integer(),
		stdDevCents: Type.Integer(),
		medianCents: Type.Integer(),
		/** Bootstrap 90% CI on the median. Populated when `nObservations` ≥ 5. */
		medianCiLowCents: Type.Optional(Type.Integer()),
		medianCiHighCents: Type.Optional(Type.Integer()),
		p25Cents: Type.Integer(),
		p75Cents: Type.Integer(),
		nObservations: Type.Integer(),
		salesPerDay: Type.Number(),
		meanDaysToSell: Type.Optional(Type.Number()),
		daysStdDev: Type.Optional(Type.Number()),
		/** 50/70/90 percentiles of the duration distribution. Populated with `nDurations` ≥ 5. */
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

/**
 * Recommended list price + the expected outcomes at that price.
 * Returned by `/v1/draft` and folded into `/v1/research/summary` for
 * convenience. Null when the market lacks `meanDaysToSell` (no
 * time-to-sell data, no model).
 */
export const ListPriceRecommendation = Type.Object(
	{
		listPriceCents: Type.Integer(),
		expectedDaysToSell: Type.Number(),
		sellProb7d: Type.Number({ minimum: 0, maximum: 1 }),
		sellProb14d: Type.Number({ minimum: 0, maximum: 1 }),
		sellProb30d: Type.Number({ minimum: 0, maximum: 1 }),
		netCents: Type.Integer(),
		dollarsPerDay: Type.Integer(),
		annualizedRoi: Type.Number(),
	},
	{ $id: "ListPriceRecommendation" },
);
export type ListPriceRecommendation = Static<typeof ListPriceRecommendation>;

/* ------------------------ POST /v1/research/summary ------------------------ */

export const MarketSummaryRequest = Type.Object(
	{
		comparables: Type.Array(ItemSummary, {
			description:
				"Sold listings (from /v1/buy/marketplace_insights/item_sales/search). Drives the price distribution.",
		}),
		asks: Type.Optional(
			Type.Array(ItemSummary, {
				description:
					"Active listings (from /v1/buy/browse/item_summary/search). Populates the asks side and unlocks the below_asks signal.",
			}),
		),
		context: Type.Optional(
			Type.Object({
				keyword: Type.Optional(Type.String()),
				marketplace: Type.Optional(Type.String({ description: "Default EBAY_US." })),
				windowDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365, description: "Default 30." })),
			}),
		),
	},
	{ $id: "MarketSummaryRequest" },
);
export type MarketSummaryRequest = Static<typeof MarketSummaryRequest>;

export const MarketSummaryResponse = Type.Object(
	{
		market: MarketStats,
		/**
		 * EV-optimal list price advice when comparables carry duration data;
		 * null when no `meanDaysToSell` could be derived.
		 */
		listPriceRecommendation: Type.Union([ListPriceRecommendation, Type.Null()]),
	},
	{ $id: "MarketSummaryResponse" },
);
export type MarketSummaryResponse = Static<typeof MarketSummaryResponse>;

/* ----------------- POST /v1/research/recovery_probability ----------------- */

/**
 * "If I buy at $X, what's the probability of recovering my money plus
 * `minNetCents` of profit within `withinDays`?"
 *
 * Internally: derive the minimum sell price needed to clear cost basis +
 * minimum net + fees + outbound shipping, then evaluate the hazard
 * model's `P(sold within d)` at that price. Confidence reflects the
 * number of duration observations the model is fit on.
 */
export const RecoveryRequest = Type.Object(
	{
		comparables: Type.Array(ItemSummary, {
			description: "Sold listings for the same SKU. Same shape as /v1/research/summary.",
		}),
		costBasisCents: Type.Integer({ description: "What the user paid (cents)." }),
		withinDays: Type.Integer({ minimum: 1, maximum: 365 }),
		minNetCents: Type.Optional(
			Type.Integer({ minimum: 0, description: "Minimum acceptable net profit. Default 0 (break even)." }),
		),
		outboundShippingCents: Type.Optional(Type.Integer({ minimum: 0 })),
		context: Type.Optional(
			Type.Object({
				keyword: Type.Optional(Type.String()),
				marketplace: Type.Optional(Type.String()),
				windowDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
			}),
		),
	},
	{ $id: "RecoveryRequest" },
);
export type RecoveryRequest = Static<typeof RecoveryRequest>;

export const RecoveryResponse = Type.Object(
	{
		/** P(sale at ≥ minSellPrice within `withinDays`). 0 when impossible to clear cost basis. */
		probability: Type.Number({ minimum: 0, maximum: 1 }),
		/** The list price the user would need to charge to clear cost basis + minNet + fees. */
		minSellPriceCents: Type.Integer(),
		/** Expected days to sell at that price. */
		expectedDaysToSell: Type.Optional(Type.Number()),
		/** Fit-data sample size (durations). Drives confidence. */
		nDurations: Type.Integer(),
		/**
		 * "high" when n ≥ 10, "medium" when n ≥ 5, "low" when n ≥ 1, "none"
		 * when no duration data at all (probability is null in that case).
		 */
		confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low"), Type.Literal("none")]),
		/** Plain-English summary, e.g. "65% chance of selling within 14 days at $355+." */
		reason: Type.String(),
	},
	{ $id: "RecoveryResponse" },
);
export type RecoveryResponse = Static<typeof RecoveryResponse>;
