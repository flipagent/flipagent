/**
 * buy/offer — auction bidding (non Best-Offer).
 */

import type { Bid, BidCreate, BidStatus } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";
import { toCents, toDollarString } from "./shared/money.js";

const STATUS_FROM: Record<string, BidStatus> = {
	HIGHEST: "active",
	WINNING: "active",
	OUTBID: "outbid",
	WON: "won",
	LOST: "lost",
	CANCELLED: "cancelled",
};

interface EbayBid {
	biddingId?: string;
	itemId?: string;
	bidId?: string;
	currentBidStatus?: string;
	bidAmount?: { value: string; currency: string };
	maxBidAmount?: { value: string; currency: string };
	endDate?: string;
	bidderUsername?: string;
	bidDate?: string;
}

function ebayBidToFlipagent(b: EbayBid): Bid {
	return {
		id: b.biddingId ?? b.bidId ?? "",
		marketplace: "ebay",
		listingId: b.itemId ?? "",
		amount: b.bidAmount
			? { value: toCents(b.bidAmount.value), currency: b.bidAmount.currency }
			: { value: 0, currency: "USD" },
		...(b.maxBidAmount
			? { maxBid: { value: toCents(b.maxBidAmount.value), currency: b.maxBidAmount.currency } }
			: {}),
		status: STATUS_FROM[b.currentBidStatus ?? "HIGHEST"] ?? "active",
		...(b.bidderUsername ? { bidder: b.bidderUsername } : {}),
		placedAt: b.bidDate ?? "",
		...(b.endDate ? { auctionEndsAt: b.endDate } : {}),
	};
}

export interface BidsContext {
	apiKeyId: string;
}

export async function listBids(ctx: BidsContext): Promise<{ bids: Bid[] }> {
	const res = await sellRequest<{ biddings?: EbayBid[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/buy/offer/v1/bidding",
	}).catch(swallowEbay404);
	return { bids: (res?.biddings ?? []).map(ebayBidToFlipagent) };
}

export async function placeBid(input: BidCreate, ctx: BidsContext): Promise<Bid> {
	const res = await sellRequest<{ biddingId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/buy/offer/v1/bidding/${encodeURIComponent(input.listingId)}/place_proxy_bid`,
		body: {
			maxAmount: input.maxBid
				? { value: toDollarString(input.maxBid.value), currency: input.maxBid.currency }
				: { value: toDollarString(input.amount.value), currency: input.amount.currency },
			userConsent: { adultItems: false },
		},
	});
	return {
		id: res?.biddingId ?? "",
		marketplace: "ebay",
		listingId: input.listingId,
		amount: input.amount,
		...(input.maxBid ? { maxBid: input.maxBid } : {}),
		status: "active",
		placedAt: new Date().toISOString(),
	};
}
