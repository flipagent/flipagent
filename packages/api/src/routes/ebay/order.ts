/**
 * eBay Buy Order API mirror — Limited Release upstream, requires eBay tenant
 * approval. All endpoints stubbed with 501 until flipagent's approval lands
 * AND the OAuth passthrough module is wired.
 *
 *   POST /buy/order/v1/checkout_session/initiate
 *   GET  /buy/order/v1/checkout_session/{checkoutSessionId}
 *   POST /buy/order/v1/checkout_session/{checkoutSessionId}/place_order
 *   GET  /buy/order/v1/purchase_order/{purchaseOrderId}
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughOrderApi } from "../../proxy/ebay-passthrough.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebayOrderRoute = new Hono();

ebayOrderRoute.post(
	"/checkout_session/initiate",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Start a checkout session",
		description: "Mirror of Order API `initiateCheckoutSession`. Limited Release.",
		responses: {
			200: { description: "Forwarded from api.ebay.com." },
			401: errorResponse("API key missing or eBay account not connected."),
			501: errorResponse("Order API approval pending — set EBAY_ORDER_API_APPROVED=1 once eBay grants access."),
			502: errorResponse("Upstream eBay request failed."),
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	ebayPassthroughOrderApi,
);

ebayOrderRoute.get(
	"/checkout_session/:sessionId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a checkout session",
		description: "Mirror of Order API `getCheckoutSession`. Limited Release.",
		responses: {
			200: { description: "Forwarded from api.ebay.com." },
			401: errorResponse("API key missing or eBay account not connected."),
			501: errorResponse("Order API approval pending — set EBAY_ORDER_API_APPROVED=1 once eBay grants access."),
			502: errorResponse("Upstream eBay request failed."),
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	ebayPassthroughOrderApi,
);

ebayOrderRoute.post(
	"/checkout_session/:sessionId/place_order",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Place the order",
		description: "Mirror of Order API `placeOrder`. Limited Release; this is the action that completes the purchase.",
		responses: {
			200: { description: "Forwarded from api.ebay.com." },
			401: errorResponse("API key missing or eBay account not connected."),
			501: errorResponse("Order API approval pending — set EBAY_ORDER_API_APPROVED=1 once eBay grants access."),
			502: errorResponse("Upstream eBay request failed."),
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	ebayPassthroughOrderApi,
);

ebayOrderRoute.get(
	"/purchase_order/:purchaseOrderId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a purchase order",
		description: "Mirror of Order API `getPurchaseOrder`. Limited Release.",
		responses: {
			200: { description: "Forwarded from api.ebay.com." },
			401: errorResponse("API key missing or eBay account not connected."),
			501: errorResponse("Order API approval pending — set EBAY_ORDER_API_APPROVED=1 once eBay grants access."),
			502: errorResponse("Upstream eBay request failed."),
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	ebayPassthroughOrderApi,
);
