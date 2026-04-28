/**
 * eBay Buy Order API v2 — guest checkout flow. Newer than v1's member
 * checkout; uses the "Checkout with eBay" widget so buyers don't need to
 * sign in to eBay. Same Limited Release gate as v1.
 *
 *   POST /buy/order/v2/guest_checkout_session/initiate
 *   GET  /buy/order/v2/guest_checkout_session/{checkoutSessionId}
 *   POST /buy/order/v2/guest_checkout_session/{checkoutSessionId}/place_order
 *   GET  /buy/order/v2/guest_purchase_order/{purchaseOrderId}
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughOrderApi } from "../../proxy/ebay-passthrough.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebayOrderV2Route = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected."),
	501: errorResponse("Order API approval pending — set EBAY_ORDER_API_APPROVED=1 once eBay grants access."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("eBay OAuth env not configured."),
};

ebayOrderV2Route.post(
	"/guest_checkout_session/initiate",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Start a guest checkout session",
		description: "Mirror of Order API v2 `initiateGuestCheckoutSession`. Limited Release.",
		responses: passthroughResponses,
	}),
	ebayPassthroughOrderApi,
);

ebayOrderV2Route.get(
	"/guest_checkout_session/:sessionId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a guest checkout session",
		description: "Mirror of Order API v2 `getGuestCheckoutSession`. Limited Release.",
		responses: passthroughResponses,
	}),
	ebayPassthroughOrderApi,
);

ebayOrderV2Route.post(
	"/guest_checkout_session/:sessionId/place_order",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Place the guest order",
		description: "Mirror of Order API v2 `placeGuestOrder`. Limited Release; completes the purchase.",
		responses: passthroughResponses,
	}),
	ebayPassthroughOrderApi,
);

ebayOrderV2Route.get(
	"/guest_purchase_order/:purchaseOrderId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a guest purchase order",
		description: "Mirror of Order API v2 `getGuestPurchaseOrder`. Limited Release.",
		responses: passthroughResponses,
	}),
	ebayPassthroughOrderApi,
);
