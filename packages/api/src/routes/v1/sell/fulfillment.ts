/**
 * eBay Sell Fulfillment API mirror. Order management on the seller side —
 * list orders, mark shipped, get tracking. OAuth passthrough required.
 *
 *   GET  /sell/fulfillment/v1/order
 *   GET  /sell/fulfillment/v1/order/{orderId}
 *   POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
 *   GET  /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment
 *   GET  /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment/{fulfillmentId}
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../../services/ebay/rest/client.js";
import { errorResponse } from "../../../utils/openapi.js";

export const ebaySellFulfillmentRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("eBay OAuth env not configured."),
};

ebaySellFulfillmentRoute.get(
	"/order",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "List orders",
		description: "Mirror of Sell Fulfillment `getOrders`. Filters by date, status, etc.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellFulfillmentRoute.get(
	"/order/:orderId",
	describeRoute({ tags: ["eBay-compat"], summary: "Get an order", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellFulfillmentRoute.post(
	"/order/:orderId/shipping_fulfillment",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Create shipping fulfillment (mark shipped)",
		description:
			"Mirror of `createShippingFulfillment`. Records carrier + tracking, completes the seller's obligation.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellFulfillmentRoute.get(
	"/order/:orderId/shipping_fulfillment",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "List shipping fulfillments for an order",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellFulfillmentRoute.get(
	"/order/:orderId/shipping_fulfillment/:fulfillmentId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a single shipping fulfillment",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
