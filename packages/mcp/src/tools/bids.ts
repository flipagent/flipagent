/**
 * Auction bidding tools — backed by `/v1/bids`. Use sparingly: BIN
 * via `flipagent_purchases_create` is the default flipagent flow;
 * bidding is for items only available at auction.
 */

import { BidCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ---------------------------- flipagent_bids_list -------------------------- */

export const bidsListInput = Type.Object({});
export const bidsListDescription =
	'List active and completed bids the api key has placed on auctions. Calls GET /v1/bids. **When to use** — review which auctions you\'re competing in, who\'s winning, what your max bid was. Pair with `flipagent_place_bid` to raise a bid that\'s been outbid. **Inputs** — none. **Output** — `{ bids: [{ id, itemId, maxPriceCents, currentHighCents, status: "winning" | "outbid" | "won" | "lost", endsAt }] }`. **Prereqs** — eBay account connected. On 401 the response carries `next_action`. **Example** — call with `{}`.';
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
	"Place a proxy bid on an auction. Calls POST /v1/bids. **When to use** — items only available at auction (not Buy-It-Now). For BIN, use `flipagent_create_purchase` instead — it's the default flipagent flow. eBay's proxy system handles the increment ladder for you: `maxPriceCents` is your ceiling, the system places the smallest bid needed to be high. **Inputs** — `itemId` (auction listing), `maxPriceCents` (your ceiling, cents-int). For safe ceilings, use `evaluation.bidCeilingCents` from `flipagent_evaluate_item`. **Output** — `{ id, itemId, maxPriceCents, currentHighCents, status }`. **Prereqs** — eBay account connected, plus auction-buyer eligibility (region, KYC) — check `flipagent_list_biddable_listings` first if unsure. **Example** — `{ itemId: \"234567890123\", maxPriceCents: 4500 }` (cap at $45).";
export async function bidsPlaceExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.place(args as Parameters<typeof client.bids.place>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "bids_place_failed", "/v1/bids");
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
