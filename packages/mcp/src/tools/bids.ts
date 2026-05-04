/**
 * Auction bidding tools — backed by `/v1/bids`. Use sparingly: BIN
 * via `flipagent_create_purchase` is the default flipagent flow;
 * bidding is for items only available at auction.
 */

import { BidCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ---------------------------- flipagent_bids_list -------------------------- */

export const bidsListInput = Type.Object({});
export const bidsListDescription =
	'List active and completed bids the api key has placed on auctions. Calls GET /v1/bids. **When to use** — review which auctions you\'re competing in, who\'s winning, what your max bid was. Pair with `flipagent_place_bid` to raise a bid that\'s been outbid. **Inputs** — none. **Output** — `{ bids: [{ id, listingId, amount, maxBid?, status: "active" | "outbid" | "won" | "lost" | "pending" | "cancelled", placedAt, auctionEndsAt? }] }`. **Prereqs** — eBay account connected. On 401 the response carries `next_action`. **Example** — call with `{}`.';
export async function bidsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.list();
	} catch (err) {
		return toolErrorEnvelope(err, "bids_list_failed", "/v1/bids");
	}
}

/* ---------------------------- flipagent_bids_place ------------------------- */

export { BidCreate as bidsPlaceInput };
export const bidsPlaceDescription =
	"Place a proxy bid on an auction. Calls POST /v1/bids. **When to use** — items only available at auction (not Buy-It-Now). For BIN, use `flipagent_create_purchase` instead — it's the default flipagent flow. eBay's proxy system handles the increment ladder: `maxBid` (or `amount` if `maxBid` omitted) is your ceiling, the system places the smallest bid needed to be high. **Inputs** — `listingId` (auction itemId), `amount` ({value: cents-int, currency}), optional `maxBid` (proxy ceiling, defaults to `amount`), `humanReviewedAt` (ISO timestamp ≤5 min old — required by eBay UA Feb-2026 unless EBAY_BIDDING_APPROVED REST flow), `transport` ('rest' | 'bridge'). For safe ceilings, use `evaluation.bidCeilingCents` from `flipagent_evaluate_item`. **Output** — `Bid { id, marketplace, listingId, amount, maxBid?, status, placedAt, auctionEndsAt? }`. **Async (bridge transport)** — bids placed via the Chrome extension return `status: 'pending'` immediately while the user clicks Place Bid in their browser; the server-side reconciler watches the user's eBay BidList and flips it to `active` (high bidder) or `outbid` once eBay confirms. Poll `flipagent_get_bid_status({listingId})` until `status !== 'pending'`. **DO NOT** call `flipagent_place_bid` again on a `pending` result — that double-bids. **Prereqs** — eBay account connected, plus auction-buyer eligibility (region, KYC) — check `flipagent_list_biddable_listings` first if unsure. **Example** — `{ listingId: \"234567890123\", amount: { value: 4500, currency: \"USD\" }, humanReviewedAt: \"2026-05-04T22:30:00.000Z\" }` (cap at $45).";
export async function bidsPlaceExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const result = (await client.bids.place(args as Parameters<typeof client.bids.place>[0])) as {
			status?: string;
			listingId?: string;
		};
		// `pending` = bridge transport queued the bid in the user's browser
		// and the reconciler hasn't yet seen confirmation in their BidList.
		// Surface polling instructions inline so the calling agent doesn't
		// retry POST /v1/bids (would double-bid).
		if (result.status === "pending" && result.listingId) {
			return {
				...result,
				poll_with: "flipagent_get_bid_status",
				poll_args: { listingId: result.listingId },
				terminal_states: ["active", "outbid", "won", "lost", "cancelled"],
				note: "Bid is queued in the user's browser. Poll flipagent_get_bid_status until status !== 'pending'. Do NOT re-call flipagent_place_bid (double-bid).",
			};
		}
		return result;
	} catch (err) {
		return toolErrorEnvelope(err, "bids_place_failed", "/v1/bids");
	}
}

/* ---------------------- flipagent_get_bid_status -------------------------- */

export const bidsGetStatusInput = Type.Object({
	listingId: Type.String({ description: "eBay auction itemId (the same id you used in flipagent_place_bid)" }),
});
export const bidsGetStatusDescription =
	"Read the current state of a bid you placed via `flipagent_place_bid`. Calls GET /v1/bids/{listingId}. **When to use** — poll after a `pending` response from `flipagent_place_bid` to see whether the user has finished clicking through eBay's confirmation flow. The endpoint runs the bid reconciler inline (one Trading API call, ~300-700 ms) so the very next read after the user clicks Place Bid sees the terminal state. **Inputs** — `listingId` (auction itemId). **Output** — `Bid | null` (null = no bid found for this listing under your api key). Possible `status` values: `pending` (bridge job still in flight, keep polling), `active` (live high bidder), `outbid` (bid landed but you're no longer winning), `won`/`lost` (auction ended), `cancelled`. **Polling cadence** — 2-5s while `pending`. Stop when status changes. **Example** — `{ listingId: \"234567890123\" }`.";
export async function bidsGetStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.getStatus(String(args.listingId));
	} catch (err) {
		return toolErrorEnvelope(err, "bids_get_status_failed", "/v1/bids/{listingId}");
	}
}

/* ---------------------- flipagent_bids_eligible_listings ------------------- */

export const bidsEligibleListingsInput = Type.Object({});
export const bidsEligibleListingsDescription =
	'List auctions the buyer is currently eligible to bid on, given region / category / KYC restrictions. Calls GET /v1/bids/eligible-listings. **When to use** — diagnose "why can\'t I bid on this auction?" or pre-filter a watch-list to only items where bidding is actually possible. **Inputs** — none. **Output** — `{ listings: [{ itemId, eligible: true, restrictions?: string[] }] }`. **Prereqs** — eBay account connected. **Example** — call with `{}`.';
export async function bidsEligibleListingsExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.eligibleListings();
	} catch (err) {
		return toolErrorEnvelope(err, "bids_eligible_listings_failed", "/v1/bids/eligible-listings");
	}
}
