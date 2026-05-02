/**
 * `/v1/offers/*` — Best Offer in/out, normalized.
 *
 * Inbound (buyer → seller) flows through Trading API XML
 * (GetBestOffers / RespondToBestOffer); outbound is sell/negotiation
 * REST. Caller sees one unified `Offer` shape with a `direction`
 * discriminator.
 */

import { type Offer, OfferCreate, OfferRespond, OffersListQuery, OffersListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { getBestOffers, respondToBestOffer } from "../../services/ebay/trading/best-offer.js";
import { findEligibleItems, sendOfferToWatchers } from "../../services/offers.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const offersRoute = new Hono();

offersRoute.get(
	"/",
	describeRoute({
		tags: ["Offers"],
		summary: "List Best Offers (inbound today; outbound future)",
		parameters: paramsFor("query", OffersListQuery),
		responses: {
			200: jsonResponse("Offers page.", OffersListResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbCoerce("query", OffersListQuery),
	withTradingAuth(async (c, accessToken) => {
		const limit = Number(c.req.query("limit") ?? 50);
		const listingId = c.req.query("listingId");
		const status = c.req.query("status");
		const raw = await getBestOffers({
			accessToken,
			...(listingId ? { itemId: listingId } : {}),
			entriesPerPage: limit,
			pageNumber: 1,
		});
		const offers: Offer[] = raw.map((row) => ({
			id: row.bestOfferId,
			marketplace: "ebay",
			direction: "incoming",
			status:
				row.status === "Pending"
					? "pending"
					: row.status === "Accepted"
						? "accepted"
						: row.status === "Declined"
							? "declined"
							: row.status === "Countered"
								? "countered"
								: "expired",
			listingId: row.itemId ?? "",
			...(row.buyer ? { buyer: row.buyer } : {}),
			price: {
				value: row.priceValue ? Math.round(Number.parseFloat(row.priceValue) * 100) : 0,
				currency: row.priceCurrency ?? "USD",
			},
			quantity: row.quantity ?? 1,
			...(row.message ? { message: row.message } : {}),
			...(row.expirationTime ? { expiresAt: row.expirationTime } : {}),
			createdAt: row.expirationTime ?? "",
		}));
		const filtered = status ? offers.filter((o) => o.status === status) : offers;
		return c.json({ offers: filtered, limit, offset: 0, source: "trading" as const });
	}),
);

offersRoute.post(
	"/",
	describeRoute({
		tags: ["Offers"],
		summary: "Send a Best Offer outbound to a listing's watchers",
		responses: { 201: jsonResponse("Created.", OffersListResponse), 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	tbBody(OfferCreate),
	async (c) => {
		const body = c.req.valid("json");
		const result = await sendOfferToWatchers(body, { apiKeyId: c.var.apiKey.id });
		return c.json(result, 201);
	},
);

offersRoute.get(
	"/eligible-listings",
	describeRoute({
		tags: ["Offers"],
		summary: "List eligible listings for outbound Best Offer",
		responses: { 200: { description: "Eligible items." }, 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	async (c) => {
		const result = await findEligibleItems({ apiKeyId: c.var.apiKey.id });
		return c.json({ ...result, source: "rest" as const });
	},
);

offersRoute.post(
	"/:id/respond",
	describeRoute({
		tags: ["Offers"],
		summary: "Respond to an incoming Best Offer (accept / decline / counter)",
		responses: {
			200: jsonResponse("Acknowledged.", OffersListResponse),
			400: errorResponse("Validation failed."),
		},
	}),
	requireApiKey,
	tbBody(OfferRespond),
	withTradingAuth(async (c, accessToken) => {
		const id = c.req.param("id");
		const body = (await c.req.json()) as {
			action: "accept" | "decline" | "counter";
			counterPrice?: { value: number; currency: string };
			message?: string;
		};
		const action = body.action === "accept" ? "Accept" : body.action === "decline" ? "Decline" : "Counter";
		const result = await respondToBestOffer({
			accessToken,
			bestOfferIds: [id],
			action,
			itemId: c.req.query("listingId") ?? "",
			...(body.counterPrice
				? {
						counterOfferPriceValue: (body.counterPrice.value / 100).toFixed(2),
						counterOfferPriceCurrency: body.counterPrice.currency,
					}
				: {}),
			...(body.message ? { sellerResponse: body.message } : {}),
		});
		return c.json(result);
	}),
);
