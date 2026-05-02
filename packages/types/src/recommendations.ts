/**
 * `/v1/recommendations` — listing-level optimization suggestions
 * (promoted-listings bid, international shipping, better title).
 * Wraps eBay sell/recommendation.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Page, ResponseSource } from "./_common.js";

export const Recommendation = Type.Object(
	{
		listingId: Type.String(),
		sku: Type.Optional(Type.String()),
		marketplace: Marketplace,
		recommendations: Type.Array(
			Type.Object({
				type: Type.String({ description: "AD | INTERNATIONAL_SHIPPING | TITLE | …" }),
				message: Type.Optional(Type.String()),
				suggestedBidPercentage: Type.Optional(Type.String()),
			}),
		),
	},
	{ $id: "Recommendation" },
);
export type Recommendation = Static<typeof Recommendation>;

export const RecommendationsListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		listingId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "RecommendationsListQuery" },
);
export type RecommendationsListQuery = Static<typeof RecommendationsListQuery>;

export const RecommendationsListResponse = Type.Composite(
	[Page, Type.Object({ recommendations: Type.Array(Recommendation), source: Type.Optional(ResponseSource) })],
	{ $id: "RecommendationsListResponse" },
);
export type RecommendationsListResponse = Static<typeof RecommendationsListResponse>;
