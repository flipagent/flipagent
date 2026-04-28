/**
 * eBay Sell Account API mirror. Business policies — payment, fulfillment,
 * return — that offers reference. OAuth passthrough required.
 *
 *   GET/POST /sell/account/v1/payment_policy
 *   GET/POST /sell/account/v1/fulfillment_policy
 *   GET/POST /sell/account/v1/return_policy
 *   GET      /sell/account/v1/privilege
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../proxy/ebay-passthrough.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebaySellAccountRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("eBay OAuth env not configured."),
};

ebaySellAccountRoute.get(
	"/payment_policy",
	describeRoute({ tags: ["eBay-compat"], summary: "List payment policies", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellAccountRoute.post(
	"/payment_policy",
	describeRoute({ tags: ["eBay-compat"], summary: "Create a payment policy", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellAccountRoute.get(
	"/fulfillment_policy",
	describeRoute({ tags: ["eBay-compat"], summary: "List fulfillment policies", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellAccountRoute.post(
	"/fulfillment_policy",
	describeRoute({ tags: ["eBay-compat"], summary: "Create a fulfillment policy", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellAccountRoute.get(
	"/return_policy",
	describeRoute({ tags: ["eBay-compat"], summary: "List return policies", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellAccountRoute.post(
	"/return_policy",
	describeRoute({ tags: ["eBay-compat"], summary: "Create a return policy", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellAccountRoute.get(
	"/privilege",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get seller privileges + status",
		description:
			"Mirror of `getSellerPrivilege`. Tells you whether the connected eBay account can list, sell limits, etc.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
