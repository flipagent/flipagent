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
	"List active bids the api key has placed on auctions. Calls GET /v1/bids. **When to use** — review which auctions you're competing in, who's winning, what your max bid was. Pair with `flipagent_place_bid` to raise a bid that's been outbid. **Inputs** — none. **Output** — `{ bids: [{ id, marketplace, listingId, amount, maxBid?, status, placedAt, auctionEndsAt? }], source }`. `status`: `active` (you're winning) | `outbid` (someone outbid you) | `pending` (bridge still in flight). Won/lost auctions move to other endpoints. **Prereqs** — eBay account connected. On 401 the response carries `next_action`. **Example** — call with `{}`.";
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
	'Place a proxy bid on an auction. Calls POST /v1/bids. **When to use** — items only available at auction (not Buy-It-Now). For BIN, use `flipagent_create_purchase`. eBay\'s proxy system handles the increment ladder: your `maxBid` (or `amount` if `maxBid` omitted) is the ceiling; eBay places the minimum needed to be high bidder. For safe ceilings, use `evaluation.bidCeilingCents` from `flipagent_evaluate_item`. **Inputs** — `listingId` (auction itemId), `amount` (`{value: cents-int, currency}`), optional `maxBid` (proxy ceiling, defaults to `amount`). **Output** — `Bid { id, marketplace, listingId, amount, maxBid?, status, placedAt, auctionEndsAt?, nextAction? }`. **Outcomes** — terminal status on the response (the bid is on file with eBay) **or** non-terminal `pending` with `nextAction.url` (direct the user to that URL to click Place Bid on the marketplace UI). When `pending`, response also carries `poll_with: "flipagent_get_bid_status"` + `poll_args` + `terminal_states`. **Polling cadence** — 2-5 s via `flipagent_get_bid_status` until `status !== \'pending\'` (each call runs the BidList reconciler inline). **DO NOT** re-call `flipagent_place_bid` on a pending result — that double-bids. **Prereqs** — eBay account connected. **Example** — `{ listingId: "234567890123", amount: { value: 4500, currency: "USD" } }` (cap at $45).';
export async function bidsPlaceExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const result = (await client.bids.place(args as Parameters<typeof client.bids.place>[0])) as {
			status?: string;
			listingId?: string;
		};
		// `pending` = the bid is queued and the reconciler hasn't yet
		// seen confirmation in the user's BidList. Surface polling
		// instructions inline so the calling agent doesn't retry
		// POST /v1/bids (would double-bid).
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
	"Read the current state of a bid for one auction listing. Calls GET /v1/bids/{listingId}. **When to use** — poll after a `pending` response from `flipagent_place_bid` to see whether the user has finished clicking through eBay's confirmation flow. **Inputs** — `listingId` (auction itemId). **Output** — `Bid` or 404 `no_bid` if no bid found for this listing under your api key. `status`: `pending` (bridge in flight, keep polling) | `active` (live high bidder) | `outbid` (you're no longer winning) | `won` / `lost` (auction ended) | `cancelled`. **Polling cadence** — 2-5 s while `pending`. Each call runs the bid reconciler inline (~300-700 ms Trading round-trip) so the very next read after the user clicks Place Bid sees the terminal state — no waiting for the worker tick. **Prereqs** — eBay account connected. **Example** — `{ listingId: \"234567890123\" }`.";
export async function bidsGetStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.getStatus(String(args.listingId));
	} catch (err) {
		return toolErrorEnvelope(err, "bids_get_status_failed", "/v1/bids/{listingId}");
	}
}

/* ----------------------------- flipagent_cancel_bid ----------------------- */

export const bidsCancelInput = Type.Object({
	listingId: Type.String({ description: "eBay auction itemId of the bid to cancel." }),
});
export const bidsCancelDescription =
	'Cancel an in-flight bridge place-bid for this listing. Calls POST /v1/bids/{listingId}/cancel. **When to use** — abort a `pending` bid that the user hasn\'t clicked through yet (agent changed its mind, user asked to back out before confirming). **Cannot retract a bid already landed on eBay** — eBay\'s retraction rules are narrow (typo / item changed materially / can\'t reach seller) and require a manual ebay.com flow. **Inputs** — `listingId` (auction itemId). **Output** — the cancelled `Bid` (`status: "cancelled"`), or 404 `no_inflight_bid` if nothing was queued for this listing. **Prereqs** — none beyond the api key. **Example** — `{ listingId: "234567890123" }`.';
export async function bidsCancelExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.cancel(String(args.listingId));
	} catch (err) {
		return toolErrorEnvelope(err, "bids_cancel_failed", "/v1/bids/{listingId}/cancel");
	}
}
