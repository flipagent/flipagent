/**
 * Best-Offer tools — backed by `/v1/offers`. Inbound offers (buyer →
 * seller) come from Trading XML; outbound seller-initiated offers go
 * through Sell Negotiation REST. Caller sees one unified `Offer` shape
 * with a `direction` discriminator.
 */

import { OfferCreate, OfferRespond, OffersListQuery } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";
import { uiResource } from "../ui-resource.js";

/* --------------------------- flipagent_offers_list ------------------------- */

export { OffersListQuery as offersListInput };

export const offersListDescription =
	'List Best Offers (incoming buyer offers + outbound seller offers) on the connected account. Calls GET /v1/offers. **When to use** — find pending offers that need a decision (`direction: "incoming", status: "pending"`); track outbound "Send Offer" campaigns; audit historical negotiation. **Inputs** — optional `direction` (`incoming | outgoing`), optional `status` (`pending | accepted | declined | countered | expired`), optional `listingId`, optional `marketplace`, pagination `limit` (default 50) + `offset`. **Output** — `{ offers: Offer[], limit, offset }`. Hosts that support MCP Apps render an inline offers panel (incoming offers, with Accept / Counter / Decline / Evaluate per row); other hosts get the raw JSON. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action`. **Example** — `{ direction: "incoming", status: "pending" }`.';

interface RawOffer {
	id: string;
	direction?: string;
	status?: string;
	listingId?: string;
	price?: { value: number; currency: string };
	createdAt?: string;
}

interface ItemDetail {
	title?: string;
	url?: string;
	images?: string[];
	price?: { value: number; currency: string };
	condition?: string;
}

export async function offersListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const result = await client.offers.list(args as Parameters<typeof client.offers.list>[0]);
		const offers = ((result as { offers?: unknown[] }).offers ?? []) as RawOffer[];

		// Inline panel renders incoming offers only — outgoing/closed offers
		// fall back to the raw JSON (already accurate via `result`). The
		// `direction` filter the caller passed is honored upstream; we still
		// guard here in case the host called with no filter.
		const incoming = offers.filter((o) => o.direction !== "outgoing");

		// Enrich each row with the listing's title / image / list price so
		// the panel reads cleanly. Parallel fetch, dedup by listingId — a
		// missing listing degrades that row to an `id`-only stub instead of
		// failing the whole call.
		const listingIds = Array.from(new Set(incoming.map((o) => o.listingId).filter((id): id is string => !!id)));
		const itemMap = new Map<string, ItemDetail>();
		await Promise.all(
			listingIds.map(async (lid) => {
				try {
					const item = (await client.items.get(lid)) as ItemDetail;
					itemMap.set(lid, item);
				} catch {
					// keep going; the row will render with the listingId only.
				}
			}),
		);

		const panelOffers = incoming.map((o) => {
			const detail = (o.listingId && itemMap.get(o.listingId)) || {};
			return {
				offerId: o.id,
				item: {
					itemId: o.listingId,
					title: detail.title ?? (o.listingId ? `Listing ${o.listingId}` : "Listing"),
					...(detail.url ? { url: detail.url } : {}),
					...(detail.images?.[0] ? { image: detail.images[0] } : {}),
					listPrice: detail.price ?? { value: 0, currency: "USD" },
					...(detail.condition ? { condition: detail.condition } : {}),
				},
				buyerOffer: o.price ?? { value: 0, currency: "USD" },
				...(o.createdAt ? { createdAt: o.createdAt } : {}),
			};
		});

		const summary =
			panelOffers.length === 0
				? "No pending Best Offers right now."
				: `${panelOffers.length} pending Best Offer${panelOffers.length === 1 ? "" : "s"}. Each row has Accept / Counter / Decline / Evaluate.`;

		return uiResource({
			uri: "ui://flipagent/offers",
			structuredContent: { offers: panelOffers },
			summary,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "offers_list_failed", "/v1/offers");
	}
}

/* -------------------------- flipagent_offers_create ------------------------ */

export { OfferCreate as offersCreateInput };

export const offersCreateDescription =
	'Send a seller-initiated Best Offer to a listing\'s recent watchers (eBay\'s "Send Offers" feature). Calls POST /v1/offers. **When to use** — convert window-shopping watchers into buyers; pair with `flipagent_list_offer_eligible_listings` to find listings with watchers but no recent sales. **Inputs** — `listingIds: string[]`, plus EITHER `discountPercent` (1–60) OR `priceCents` (cents-int absolute), optional `message` (≤200 chars), optional `expiresInHours` (default 48, max 48). **Output** — `{ created: [{ id, listingId, sentTo, expiresAt }], skipped?: [{ listingId, reason }] }`. **Prereqs** — eBay seller account connected. **Example** — `{ listingIds: ["v1|234567890123|0"], discountPercent: 10, message: "Saw you watching — here\'s 10% off." }`.';

export async function offersCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.offers.create(args as Parameters<typeof client.offers.create>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "offers_create_failed", "/v1/offers");
	}
}

/* --------------------- flipagent_offers_eligible_listings ------------------ */

export const offersEligibleListingsInput = Type.Object({});

export const offersEligibleListingsDescription =
	"List the seller's listings that are currently eligible to receive outbound Best Offers. Calls GET /v1/offers/eligible-listings. **When to use** — required-ish step before `flipagent_create_offer`; eBay only allows Send Offer on listings that have watchers, are Buy-It-Now, aren't already promoted, etc. — calling this avoids 412s. **Inputs** — none. **Output** — `{ listings: [{ listingId, watcherCount, currentPriceCents, eligibleSince }] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`, then pick listings with `watcherCount >= 3` to send offers to.";

export async function offersEligibleListingsExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.offers.eligibleListings();
	} catch (err) {
		return toolErrorEnvelope(err, "offers_eligible_listings_failed", "/v1/offers/eligible-listings");
	}
}

/* -------------------------- flipagent_offers_respond ----------------------- */

export const offersRespondInput = Type.Composite([Type.Object({ id: Type.String({ minLength: 1 }) }), OfferRespond]);

export const offersRespondDescription =
	'Take action on an incoming Best Offer from a buyer. Calls POST /v1/offers/{id}/respond. **When to use** — close out pending offers from `flipagent_list_offers({ direction: "incoming", status: "pending" })`. eBay holds the offer until the seller responds OR it times out (typically 48h). **Inputs** — `id` (offer id), `action` (`"accept" | "decline" | "counter"`); for `counter` also pass `priceCents` (cents-int) and optional `message`. **Output** — `{ id, status, respondedAt }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "OFR-12345", action: "counter", priceCents: 5800, message: "Best I can do is $58 shipped." }`.';

export async function offersRespondExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.offers.respond(id, body as Parameters<typeof client.offers.respond>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "offers_respond_failed", `/v1/offers/${id}/respond`);
	}
}
