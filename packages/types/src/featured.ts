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
