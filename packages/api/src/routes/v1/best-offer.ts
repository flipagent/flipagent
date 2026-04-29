/**
 * `/v1/best-offer/*` — incoming Best Offer triage. Sell Negotiation
 * REST covers *outbound* offers (seller → watcher); inbound buyer
 * offers still flow through Trading.
 *
 *   GET  /v1/best-offer            — list pending incoming offers
 *   POST /v1/best-offer/respond    — accept / decline / counter
 */

import { type Static, Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { getBestOffers, respondToBestOffer } from "../../services/ebay/trading/best-offer.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const bestOfferRoute = new Hono();

const BestOfferEntry = Type.Object(
	{
		bestOfferId: Type.String(),
		itemId: Type.Union([Type.String(), Type.Null()]),
		buyer: Type.Union([Type.String(), Type.Null()]),
		priceValue: Type.Union([Type.String(), Type.Null()]),
		priceCurrency: Type.Union([Type.String(), Type.Null()]),
		quantity: Type.Union([Type.Integer(), Type.Null()]),
		status: Type.Union([Type.String(), Type.Null()]),
		expirationTime: Type.Union([Type.String(), Type.Null()]),
		message: Type.Union([Type.String(), Type.Null()]),
	},
	{ $id: "BestOfferEntry" },
);

const ListResponse = Type.Object({ offers: Type.Array(BestOfferEntry) }, { $id: "BestOfferListResponse" });

const RespondRequest = Type.Object(
	{
		itemId: Type.String(),
		bestOfferIds: Type.Array(Type.String()),
		action: Type.Union([Type.Literal("Accept"), Type.Literal("Decline"), Type.Literal("Counter")]),
		sellerResponse: Type.Optional(Type.String()),
		counterOfferPriceValue: Type.Optional(Type.String()),
		counterOfferPriceCurrency: Type.Optional(Type.String()),
		counterOfferQuantity: Type.Optional(Type.Integer()),
	},
	{ $id: "BestOfferRespondRequest" },
);

const AckResponse = Type.Object({ ack: Type.String() }, { $id: "BestOfferRespondResponse" });

bestOfferRoute.get(
	"/",
	describeRoute({
		tags: ["Best Offer"],
		summary: "List pending incoming Best Offers (Trading GetBestOffers)",
		responses: {
			200: jsonResponse("Pending offer slice.", ListResponse),
			401: errorResponse("API key missing or eBay account not connected."),
			502: errorResponse("Trading API call failed."),
		},
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const status = c.req.query("status") as Parameters<typeof getBestOffers>[0]["bestOfferStatus"];
		const offers = await getBestOffers({
			accessToken,
			itemId: c.req.query("itemId") ?? undefined,
			bestOfferStatus: status ?? undefined,
			pageNumber: c.req.query("page") ? Number(c.req.query("page")) : undefined,
			entriesPerPage: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
		});
		return c.json({ offers });
	}),
);

bestOfferRoute.post(
	"/respond",
	describeRoute({
		tags: ["Best Offer"],
		summary: "Accept / decline / counter incoming Best Offers (Trading RespondToBestOffer)",
		responses: {
			200: jsonResponse("Acknowledged.", AckResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("API key missing or eBay account not connected."),
			502: errorResponse("Trading API call failed."),
		},
	}),
	requireApiKey,
	tbBody(RespondRequest),
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as Static<typeof RespondRequest>;
		const result = await respondToBestOffer({ accessToken, ...body });
		return c.json(result);
	}),
);
