/**
 * `/v1/research/*` schemas — market thesis. Aggregates sold-side stats
 * (and optionally active asks) into a single bundle the agent can pass
 * to `/v1/draft`, `/v1/reprice`, and `/v1/discover` without re-fetching
 * comps for every call.
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
 * least one comp carried duration data; `asks` populates only when
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
		p25Cents: Type.Integer(),
		p75Cents: Type.Integer(),
		nObservations: Type.Integer(),
		salesPerDay: Type.Number(),
		meanDaysToSell: Type.Optional(Type.Number()),
		daysStdDev: Type.Optional(Type.Number()),
		nDurations: Type.Optional(Type.Integer()),
		asks: Type.Optional(AskStats),
		asOf: Type.String(),
	},
	{ $id: "MarketStats" },
);
export type MarketStats = Static<typeof MarketStats>;

/**
 * Recommended list price + the expected outcomes at that price.
 * Returned by `/v1/draft` and folded into `/v1/research/thesis` for
 * convenience. Null when the market lacks `meanDaysToSell` (no
 * time-to-sell data, no model).
 */
export const ListPriceAdvice = Type.Object(
	{
		listPriceCents: Type.Integer(),
		expectedDaysToSell: Type.Number(),
		sellProb7d: Type.Number({ minimum: 0, maximum: 1 }),
		sellProb14d: Type.Number({ minimum: 0, maximum: 1 }),
		netCents: Type.Integer(),
		dollarsPerDay: Type.Integer(),
		annualizedRoi: Type.Number(),
	},
	{ $id: "ListPriceAdvice" },
);
export type ListPriceAdvice = Static<typeof ListPriceAdvice>;

/* ------------------------ POST /v1/research/thesis ------------------------ */

export const ResearchThesisRequest = Type.Object(
	{
		comps: Type.Array(ItemSummary, {
			description: "Sold listings (from /v1/sold/search). Drives the price distribution.",
		}),
		asks: Type.Optional(
			Type.Array(ItemSummary, {
				description:
					"Active listings (from /v1/listings/search). Populates the asks side and unlocks the below_asks signal.",
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
	{ $id: "ResearchThesisRequest" },
);
export type ResearchThesisRequest = Static<typeof ResearchThesisRequest>;

export const ResearchThesisResponse = Type.Object(
	{
		market: MarketStats,
		/**
		 * EV-optimal list price advice when comps carry duration data;
		 * null when no `meanDaysToSell` could be derived.
		 */
		listPriceAdvice: Type.Union([ListPriceAdvice, Type.Null()]),
	},
	{ $id: "ResearchThesisResponse" },
);
export type ResearchThesisResponse = Static<typeof ResearchThesisResponse>;
