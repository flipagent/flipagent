/**
 * `/v1/post-order/*` mirror of eBay Post Order API
 * (`/post-order/v2/*`). Cases, returns, cancellations, inquiries,
 * issues — the full "after the buy went sideways" surface. Replaces
 * many legacy Trading-API dispute calls.
 *
 * Subpaths (each is a distinct workflow):
 *   /post-order/v2/return/*          — buyer return RMAs
 *   /post-order/v2/cancellation/*    — order cancellation requests
 *   /post-order/v2/case/*            — INR / SNAD claims escalated to eBay
 *   /post-order/v2/inquiry/*         — pre-claim buyer inquiries
 *   /post-order/v2/issue/*           — issue triage
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../services/ebay/rest/client.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebayPostOrderRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

ebayPostOrderRoute.all(
	"/*",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Post Order — returns, cancellations, cases, inquiries, issues",
		description:
			"Catch-all mirror of /post-order/v2/*. Use for the full after-sale dispute lifecycle. See https://developer.ebay.com/Devzone/post-order/index.html.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
