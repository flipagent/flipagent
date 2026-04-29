/**
 * `/v1/sell/negotiation/*` mirror of eBay Sell Negotiation API
 * (`/sell/negotiation/v1`). Lets sellers proactively send Best Offer
 * proposals to buyers who watched / abandoned-cart eligible items.
 *
 * Distinct from incoming Best Offer responses (Trading API
 * `RespondToBestOffer` — wired separately at /v1/best-offer).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../../services/ebay/rest/client.js";
import { errorResponse } from "../../../utils/openapi.js";

export const ebaySellNegotiationRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

ebaySellNegotiationRoute.all(
	"/*",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Sell Negotiation — outbound Best Offer to interested buyers",
		description:
			"Catch-all mirror of /sell/negotiation/v1/*. Endpoints: find_eligible_items, send_offer_to_interested_buyers. See https://developer.ebay.com/api-docs/sell/negotiation/overview.html.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
