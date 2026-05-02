/**
 * `client.offers.*` — Best Offer in/out, normalized.
 *
 * Inbound (buyer → seller) flows through Trading API XML; outbound is
 * sell/negotiation REST. Caller sees one unified `Offer` shape with a
 * `direction` discriminator.
 */

import type { Offer, OfferCreate, OfferRespond, OffersListQuery, OffersListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface OffersClient {
	list(params?: OffersListQuery): Promise<OffersListResponse>;
	create(body: OfferCreate): Promise<OffersListResponse>;
	eligibleListings(): Promise<{ items: Offer[]; source: string }>;
	respond(id: string, body: OfferRespond): Promise<OffersListResponse>;
}

export function createOffersClient(http: FlipagentHttp): OffersClient {
	return {
		list: (params) => http.get("/v1/offers", params as Record<string, string | number | undefined> | undefined),
		create: (body) => http.post("/v1/offers", body),
		eligibleListings: () => http.get("/v1/offers/eligible-listings"),
		respond: (id, body) => http.post(`/v1/offers/${encodeURIComponent(id)}/respond`, body),
	};
}
