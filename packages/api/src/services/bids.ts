/**
 * buy/offer — auction proxy bidding.
 *
 * eBay's REST surface for bidding is per-item, not list-shaped:
 *
 *   POST `/buy/offer/v1_beta/bidding/{itemId}/place_proxy_bid`
 *   GET  `/buy/offer/v1_beta/bidding/{itemId}` — current bid status
 *
 * There is no REST endpoint that returns "all my bids" — Trading
 * `GetMyeBayBuying.BidList` is the only path. The list view here
 * therefore routes through Trading and reuses the row→Item shape from
 * `services/me-overview.ts`. The previous wrapper called
 * `/buy/offer/v1/bidding` (no `_beta`, no item-id), which returned a
 * silent 404 swallowed by the now-removed `.catch(() => null)`.
 * Verified live 2026-05-02: `/buy/offer/v1_beta/bidding/{id}/place_proxy_bid`
 * returns errorId 2004 ACCESS on a fake itemId — endpoint exists, this
 * is the right path.
 */

import type { Bid, BidCreate, BidStatus } from "@flipagent/types";
import { getUserAccessToken } from "./ebay/oauth.js";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";
import { getMyEbayBuying } from "./ebay/trading/myebay.js";
import { toCents, toDollarString } from "./shared/money.js";

// eBay's `auctionStatus` enum values per OAS3 spec
// (`references/ebay-mcp/docs/_mirror/buy_offer_v1_beta_oas3.json`)
// AuctionStatusEnum: LIVE | ENDED. flipagent's `BidStatus` is more
// granular (active/won/lost/outbid/cancelled) — we derive won/lost
// from `highBidder` when ENDED in `ebayBidToFlipagent`.

/**
 * eBay's `Bidding` response shape (verified against the OAS3 spec
 * 2026-05-03 via field-diff). Earlier versions of this wrapper invented
 * field names like `biddingId`, `bidAmount`, `bidderUsername`,
 * `currentBidStatus` — none of which are in the spec. Every field below
 * is verbatim from `components.schemas.Bidding`.
 */
interface EbayBidding {
	auctionEndDate?: string;
	auctionStatus?: string;
	bidCount?: number;
	currentPrice?: { value: string; currency: string };
	currentProxyBid?: { maxAmount?: { value: string; currency: string }; proxyBidId?: string };
	highBidder?: boolean;
	itemId?: string;
	reservePriceMet?: boolean;
}

function ebayBidToFlipagent(b: EbayBidding, fallbackItemId?: string): Bid {
	const ended = b.auctionStatus === "ENDED";
	const status: BidStatus = ended ? (b.highBidder ? "won" : "lost") : "active";
	return {
		id: b.currentProxyBid?.proxyBidId ?? "",
		marketplace: "ebay",
		listingId: b.itemId ?? fallbackItemId ?? "",
		amount: b.currentPrice
			? { value: toCents(b.currentPrice.value), currency: b.currentPrice.currency }
			: { value: 0, currency: "USD" },
		...(b.currentProxyBid?.maxAmount
			? {
					maxBid: {
						value: toCents(b.currentProxyBid.maxAmount.value),
						currency: b.currentProxyBid.maxAmount.currency,
					},
				}
			: {}),
		status,
		// eBay never exposes the bidder's username — only `highBidder: bool`.
		// `placedAt` not in spec either; left blank rather than fabricated.
		placedAt: "",
		...(b.auctionEndDate ? { auctionEndsAt: b.auctionEndDate } : {}),
	};
}

export interface BidsContext {
	apiKeyId: string;
}

export async function listBids(ctx: BidsContext): Promise<{ bids: Bid[] }> {
	const token = await getUserAccessToken(ctx.apiKeyId);
	const buying = await getMyEbayBuying(token);
	const bids: Bid[] = buying.bidding.items.map((row) => ({
		id: row.itemId,
		marketplace: "ebay",
		listingId: row.itemId,
		amount: row.priceValue
			? { value: toCents(row.priceValue), currency: row.priceCurrency ?? "USD" }
			: { value: 0, currency: "USD" },
		status: "active",
		placedAt: row.startDate ?? "",
		...(row.endDate ? { auctionEndsAt: row.endDate } : {}),
	}));
	return { bids };
}

export async function getBidStatus(itemId: string, ctx: BidsContext): Promise<Bid | null> {
	const res = await sellRequest<EbayBidding>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/buy/offer/v1_beta/bidding/${encodeURIComponent(itemId)}`,
	}).catch(swallowEbay404);
	return res ? ebayBidToFlipagent(res, itemId) : null;
}

export async function placeBid(input: BidCreate, ctx: BidsContext): Promise<Bid> {
	// `PlaceProxyBidResponse` per spec returns `{ proxyBidId }` only —
	// NOT `biddingId` (verified 2026-05-03). The bid is recorded once
	// the response comes back; current price + proxy bid amount come
	// from a follow-up GET /bidding/{itemId} call.
	const res = await sellRequest<{ proxyBidId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/buy/offer/v1_beta/bidding/${encodeURIComponent(input.listingId)}/place_proxy_bid`,
		body: {
			maxAmount: input.maxBid
				? { value: toDollarString(input.maxBid.value), currency: input.maxBid.currency }
				: { value: toDollarString(input.amount.value), currency: input.amount.currency },
			userConsent: { adultItems: false },
		},
	});
	return {
		id: res?.proxyBidId ?? "",
		marketplace: "ebay",
		listingId: input.listingId,
		amount: input.amount,
		...(input.maxBid ? { maxBid: input.maxBid } : {}),
		status: "active",
		placedAt: new Date().toISOString(),
	};
}
