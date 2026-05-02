/**
 * `client.bids.*` — buyer-side proxy bidding.
 */

import type { Bid, BidCreate, BidsListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface BidsClient {
	list(): Promise<BidsListResponse>;
	place(body: BidCreate): Promise<Bid>;
	eligibleListings(): Promise<unknown>;
}

export function createBidsClient(http: FlipagentHttp): BidsClient {
	return {
		list: () => http.get("/v1/bids"),
		place: (body) => http.post("/v1/bids", body),
		eligibleListings: () => http.get("/v1/bids/eligible-listings"),
	};
}
