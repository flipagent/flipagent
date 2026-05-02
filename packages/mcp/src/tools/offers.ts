/**
 * Best-Offer tools — backed by `/v1/offers`. Inbound offers (buyer →
 * seller) come from Trading XML; outbound seller-initiated offers go
 * through Sell Negotiation REST. Caller sees one unified `Offer` shape
 * with a `direction` discriminator.
 */

import { OfferCreate, OfferRespond, OffersListQuery } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* --------------------------- flipagent_offers_list ------------------------- */

export { OffersListQuery as offersListInput };

export const offersListDescription =
	"List Best Offers for the connected seller. GET /v1/offers. Filter by `direction` (incoming|outgoing) + `status` (pending|accepted|declined|countered|expired). Use `direction:'incoming', status:'pending'` to find offers needing a decision.";

export async function offersListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.offers.list(args as Parameters<typeof client.offers.list>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/offers");
		return { error: "offers_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_offers_create ------------------------ */

export { OfferCreate as offersCreateInput };

export const offersCreateDescription =
	"Send a seller-initiated Best Offer to recent watchers (eBay's 'Send Offers' feature). POST /v1/offers. Required: `listingIds`, `discountPercent` or `priceCents`, optional `message`. Outbound offers expire after 48h.";

export async function offersCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.offers.create(args as Parameters<typeof client.offers.create>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/offers");
		return { error: "offers_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_offers_eligible_listings ------------------ */

export const offersEligibleListingsInput = Type.Object({});

export const offersEligibleListingsDescription =
	"List the seller's listings that are currently eligible for outbound Best Offers (have watchers, not promoted, etc.). GET /v1/offers/eligible-listings. Use before `flipagent_offers_create` to know which `listingIds` to target.";

export async function offersEligibleListingsExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.offers.eligibleListings();
	} catch (err) {
		const e = toApiCallError(err, "/v1/offers/eligible-listings");
		return { error: "offers_eligible_listings_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_offers_respond ----------------------- */

export const offersRespondInput = Type.Composite([Type.Object({ id: Type.String({ minLength: 1 }) }), OfferRespond]);

export const offersRespondDescription =
	"Respond to an incoming Best Offer. POST /v1/offers/{id}/respond. `action` is `accept | decline | counter`; counter requires `priceCents`. Use after `flipagent_offers_list({ direction:'incoming', status:'pending' })`.";

export async function offersRespondExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.offers.respond(id, body as Parameters<typeof client.offers.respond>[1]);
	} catch (err) {
		const e = toApiCallError(err, `/v1/offers/${id}/respond`);
		return { error: "offers_respond_failed", status: e.status, url: e.url, message: e.message };
	}
}
