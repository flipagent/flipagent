/**
 * `/v1/bids/*` — auction bidding (eBay buy/offer).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, ResponseSource } from "./_common.js";

export const BidStatus = Type.Union(
	[
		Type.Literal("active"),
		Type.Literal("outbid"),
		Type.Literal("won"),
		Type.Literal("lost"),
		Type.Literal("cancelled"),
	],
	{ $id: "BidStatus" },
);
export type BidStatus = Static<typeof BidStatus>;

export const Bid = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		listingId: Type.String(),
		amount: Money,
		maxBid: Type.Optional(Money),
		status: BidStatus,
		bidder: Type.Optional(Type.String()),
		placedAt: Type.String(),
		auctionEndsAt: Type.Optional(Type.String()),
	},
	{ $id: "Bid" },
);
export type Bid = Static<typeof Bid>;

export const BidCreate = Type.Object(
	{
		listingId: Type.String(),
		amount: Money,
		maxBid: Type.Optional(Money),
	},
	{ $id: "BidCreate" },
);
export type BidCreate = Static<typeof BidCreate>;

export const BidsListResponse = Type.Object(
	{ bids: Type.Array(Bid), source: Type.Optional(ResponseSource) },
	{ $id: "BidsListResponse" },
);
export type BidsListResponse = Static<typeof BidsListResponse>;
