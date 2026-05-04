/**
 * `/v1/featured` — eBay's curated daily-deals + events surface.
 * Wraps buy/deal.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Page, ResponseSource } from "./_common.js";
import { Item } from "./items.js";

export const FeaturedDealKind = Type.Union([Type.Literal("daily_deal"), Type.Literal("event_deal")], {
	$id: "FeaturedDealKind",
});
export type FeaturedDealKind = Static<typeof FeaturedDealKind>;

export const FeaturedDeal = Type.Composite(
	[
		Item,
		Type.Object({
			dealKind: FeaturedDealKind,
			dealId: Type.String(),
			eventId: Type.Optional(Type.String()),
			eventTitle: Type.Optional(Type.String()),
			savingsPercentage: Type.Optional(Type.String()),
			endsAt: Type.Optional(Type.String()),
		}),
	],
	{ $id: "FeaturedDeal" },
);
export type FeaturedDeal = Static<typeof FeaturedDeal>;

export const FeaturedListResponse = Type.Composite(
	[Page, Type.Object({ deals: Type.Array(FeaturedDeal), source: Type.Optional(ResponseSource) })],
	{ $id: "FeaturedListResponse" },
);
export type FeaturedListResponse = Static<typeof FeaturedListResponse>;

/* ---------------- Buy Marketing — merchandised + also_bought / also_viewed (LR) ---------------- */

export const MerchandisedProduct = Type.Object(
	{
		epid: Type.Optional(Type.String()),
		title: Type.String(),
		image: Type.Optional(Type.String()),
		averagePrice: Type.Optional(Type.String({ description: "eBay-shape dollar string (kept verbatim)." })),
		ratingAggregate: Type.Optional(Type.Number()),
		reviewCount: Type.Optional(Type.Integer()),
	},
	{ $id: "MerchandisedProduct" },
);
export type MerchandisedProduct = Static<typeof MerchandisedProduct>;

export const MerchandisedProductsQuery = Type.Object(
	{
		categoryId: Type.String(),
		metricName: Type.Optional(Type.String({ description: "BEST_SELLING (default).", default: "BEST_SELLING" })),
		aspectFilter: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 25 })),
	},
	{ $id: "MerchandisedProductsQuery" },
);
export type MerchandisedProductsQuery = Static<typeof MerchandisedProductsQuery>;

export const MerchandisedProductsResponse = Type.Object(
	{ products: Type.Array(MerchandisedProduct), source: Type.Optional(ResponseSource) },
	{ $id: "MerchandisedProductsResponse" },
);
export type MerchandisedProductsResponse = Static<typeof MerchandisedProductsResponse>;

export const RelatedByProductQuery = Type.Object(
	{
		epid: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.String()),
	},
	{ $id: "RelatedByProductQuery" },
);
export type RelatedByProductQuery = Static<typeof RelatedByProductQuery>;

export const RelatedByProductResponse = Type.Object(
	{ products: Type.Array(MerchandisedProduct), source: Type.Optional(ResponseSource) },
	{ $id: "RelatedByProductResponse" },
);
export type RelatedByProductResponse = Static<typeof RelatedByProductResponse>;
