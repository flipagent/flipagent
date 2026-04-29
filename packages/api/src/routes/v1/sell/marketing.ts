/**
 * `/v1/sell/marketing/*` mirror of eBay Sell Marketing API
 * (`/sell/marketing/v1`). Item promotions, sale events, advertising
 * campaigns. Requires the api-key's connected eBay refresh token.
 *
 *   GET    /v1/sell/marketing/item_promotion
 *   POST   /v1/sell/marketing/item_promotion
 *   GET    /v1/sell/marketing/item_promotion/{promotion_id}
 *   PUT    /v1/sell/marketing/item_promotion/{promotion_id}
 *   DELETE /v1/sell/marketing/item_promotion/{promotion_id}
 *   GET    /v1/sell/marketing/promotion_summary_report
 *   GET    /v1/sell/marketing/ad_campaign  (Promoted Listings)
 *   …and the rest of the Marketing surface.
 *
 * We mount a catch-all so every Marketing endpoint is reachable
 * without enumerating each one. PATH_MAP rewrites `/v1/sell/marketing/*`
 * → `/sell/marketing/v1/*` before forwarding to api.ebay.com.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../../services/ebay/rest/client.js";
import { errorResponse } from "../../../utils/openapi.js";

export const ebaySellMarketingRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

ebaySellMarketingRoute.all(
	"/*",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Sell Marketing — promotions / coupons / Promoted Listings",
		description:
			"Catch-all mirror of /sell/marketing/v1/*. Use for item_promotion CRUD, promotion_summary_report, ad_campaign (Promoted Listings), keyword recommendations, etc. See https://developer.ebay.com/api-docs/sell/marketing/overview.html.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
