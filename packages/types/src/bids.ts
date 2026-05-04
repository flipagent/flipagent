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

		/** Force a specific transport. Auto-picks when omitted. */
		transport: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("bridge")])),

		/**
		 * Per-bid human-review attestation. eBay's User Agreement
		 * (effective Feb 20, 2026) prohibits unattended LLM-driven
		 * bidding. flipagent's bridge transport requires this field
		 * on every `/v1/bids` POST; REST transport requires it
		 * unless the developer account holds Buy Offer (Bidding) API
		 * approval (`EBAY_BIDDING_APPROVED=1`). Pass an ISO-8601
		 * timestamp not older than 5 minutes — the attestation means
		 * a human in your interface confirmed THIS specific bid
		 * within the last few minutes. Shape + freshness validated
		 * by the orchestrator (uniform 412 on stale / malformed).
		 */
		humanReviewedAt: Type.Optional(Type.String({ description: "ISO-8601 timestamp" })),
	},
	{ $id: "BidCreate" },
);
export type BidCreate = Static<typeof BidCreate>;

export const BidsListResponse = Type.Object(
	{ bids: Type.Array(Bid), source: Type.Optional(ResponseSource) },
	{ $id: "BidsListResponse" },
);
export type BidsListResponse = Static<typeof BidsListResponse>;
