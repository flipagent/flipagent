/**
 * `/v1/bids/*` — auction bidding (eBay buy/offer).
 *
 * Same contract as `/v1/purchases`: response is either terminal (the
 * bid is on file with eBay; agent shows the result and stops) or
 * non-terminal with `nextAction` (user action is needed; agent
 * directs the user to `nextAction.url` and polls
 * `GET /v1/bids/{listingId}` until the status flips). Whether the
 * API places the bid via Buy Offer REST, hands it to a paired
 * Chrome extension, or returns a deeplink for the user to complete
 * on ebay.com is an internal implementation detail.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, NextAction } from "./_common.js";

export const BidStatus = Type.Union(
	[
		// `pending` = a tracking row was created and the user hasn't
		// clicked through eBay's confirmation flow yet. Reconciler in
		// `services/bid-reconciler.ts` flips it to `active` (or `outbid`)
		// once `GetMyeBayBuying.BidList` confirms the bid landed; agents
		// poll `GET /v1/bids/{listingId}` to see the transition.
		Type.Literal("pending"),
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

		/**
		 * Set when the bid needs the user to do something on the
		 * marketplace UI (open the listing and click Place Bid).
		 * Absent when the bid was placed server-side or has already
		 * reached a terminal status.
		 */
		nextAction: Type.Optional(NextAction),
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

export const BidsListResponse = Type.Object({ bids: Type.Array(Bid) }, { $id: "BidsListResponse" });
export type BidsListResponse = Static<typeof BidsListResponse>;
