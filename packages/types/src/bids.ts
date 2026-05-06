/**
 * `/v1/bids/*` — auction bidding (eBay buy/offer).
 *
 * Three transports surface through the same shape:
 *   - REST   (with `EBAY_BIDDING_APPROVED=1`) — eBay's Buy Offer API
 *            places the proxy bid server-side.
 *   - BRIDGE (paired Chrome extension) — extension opens the ebay.com/
 *            itm tab and surfaces a Place-Bid panel observer.
 *   - URL    (no extension, no REST approval) — the API returns
 *            `nextAction.url` pointing at the ebay.com/itm page; the
 *            user clicks Place Bid on eBay's own UI.
 *
 * Trading-API reconciler matches the resulting `BidList` diff against
 * a snapshot captured at queue time regardless of transport. Auto-pick
 * order: REST (if approved) → BRIDGE (if paired) → URL.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, NextAction, ResponseSource } from "./_common.js";

export const BidStatus = Type.Union(
	[
		// `pending` = bridge or url transport queued the bid in the
		// tracking row; the user hasn't clicked through eBay's
		// confirmation flow yet. The reconciler in
		// `services/bid-reconciler.ts` flips it to `active` (or
		// `outbid`) once `GetMyeBayBuying.BidList` confirms it landed;
		// agents poll `GET /v1/bids/{listingId}` to see the transition.
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
		 * Deeplink to drive the bid forward when transport is "url".
		 * Agent/UI directs the user to `nextAction.url` (the ebay.com/itm
		 * page) to click Place Bid. Omitted in REST + bridge transports.
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

		/** Force a specific transport. Auto-picks when omitted. */
		transport: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("bridge"), Type.Literal("url")])),
	},
	{ $id: "BidCreate" },
);
export type BidCreate = Static<typeof BidCreate>;

export const BidsListResponse = Type.Object(
	{ bids: Type.Array(Bid), source: Type.Optional(ResponseSource) },
	{ $id: "BidsListResponse" },
);
export type BidsListResponse = Static<typeof BidsListResponse>;
