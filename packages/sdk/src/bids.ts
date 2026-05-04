/**
 * `client.bids.*` — buyer-side proxy bidding.
 */

import type { Bid, BidCreate, BidsListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface BidsClient {
	list(): Promise<BidsListResponse>;
	place(body: BidCreate): Promise<Bid>;
	getStatus(listingId: string): Promise<Bid | null>;
	eligibleListings(): Promise<unknown>;
}

export function createBidsClient(http: FlipagentHttp): BidsClient {
	return {
		list: () => http.get("/v1/bids"),
		place: (body) => http.post("/v1/bids", body),
		getStatus: (listingId) => http.get(`/v1/bids/${encodeURIComponent(listingId)}`),
		eligibleListings: () => http.get("/v1/bids/eligible-listings"),
	};
}
