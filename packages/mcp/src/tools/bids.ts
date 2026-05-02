/**
 * Auction bidding tools — backed by `/v1/bids`. Use sparingly: BIN
 * via `flipagent_purchases_create` is the default flipagent flow;
 * bidding is for items only available at auction.
 */

import { BidCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ---------------------------- flipagent_bids_list -------------------------- */

export const bidsListInput = Type.Object({});
export const bidsListDescription =
	"List active + completed bids the api key has placed. GET /v1/bids. Each row carries auction status (winning|outbid|won|lost), max bid, current high.";
export async function bidsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/bids");
		return { error: "bids_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ---------------------------- flipagent_bids_place ------------------------- */

export { BidCreate as bidsPlaceInput };
export const bidsPlaceDescription =
	"Place a bid on an auction. POST /v1/bids. Required: `itemId`, `maxPriceCents`. eBay handles the increment ladder automatically — `maxPriceCents` is your ceiling, not the placed amount.";
export async function bidsPlaceExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.place(args as Parameters<typeof client.bids.place>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/bids");
		return { error: "bids_place_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ---------------------- flipagent_bids_eligible_listings ------------------- */

export const bidsEligibleListingsInput = Type.Object({});
export const bidsEligibleListingsDescription =
	"List auctions the buyer is eligible to bid on (region/category restrictions, kyc status). GET /v1/bids/eligible-listings.";
export async function bidsEligibleListingsExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.bids.eligibleListings();
	} catch (err) {
		const e = toApiCallError(err, "/v1/bids/eligible-listings");
		return { error: "bids_eligible_listings_failed", status: e.status, url: e.url, message: e.message };
	}
}
