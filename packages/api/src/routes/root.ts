/**
 * GET / — service descriptor. Open (no key needed). Useful for liveness probes
 * and as a quick "is this api.flipagent.dev" check from a browser.
 */

import { RootDescriptor } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { jsonResponse } from "../utils/openapi.js";

export const rootRoute = new Hono();

rootRoute.get(
	"/",
	describeRoute({
		tags: ["System"],
		summary: "Service descriptor",
		security: [],
		responses: {
			200: jsonResponse("Manifest of available paths.", RootDescriptor),
		},
	}),
	(c) =>
		c.json({
			name: "flipagent",
			docs: "https://flipagent.dev/docs",
			ebay_compatible: false,
			paths: [
				// Listings: discovery (search + detail + batch)
				"GET /v1/listings/search",
				"GET /v1/listings/{itemId}",
				"GET /v1/listings/get_items",
				"GET /v1/listings/get_items_by_item_group",
				// Sold: comparable-sales lookup
				"GET /v1/sold/search",
				// Orders: member checkout (Limited Release)
				"POST /v1/orders/checkout/checkout_session/initiate",
				"GET /v1/orders/checkout/checkout_session/{sessionId}",
				"POST /v1/orders/checkout/checkout_session/{sessionId}/place_order",
				"GET /v1/orders/checkout/purchase_order/{purchaseOrderId}",
				// Orders: guest checkout (Limited Release)
				"POST /v1/orders/guest/guest_checkout_session/initiate",
				"GET /v1/orders/guest/guest_checkout_session/{sessionId}",
				"POST /v1/orders/guest/guest_checkout_session/{sessionId}/place_order",
				"GET /v1/orders/guest/guest_purchase_order/{purchaseOrderId}",
				// Inventory: seller-side write (user OAuth)
				"PUT|GET|DELETE /v1/inventory/inventory_item/{sku}",
				"POST|GET|PUT|DELETE /v1/inventory/offer/{offerId}",
				"POST /v1/inventory/offer/{offerId}/publish",
				"POST /v1/inventory/location/{merchantLocationKey}",
				// Fulfillment: shipping + tracking
				"GET /v1/fulfillment/order",
				"POST /v1/fulfillment/order/{orderId}/shipping_fulfillment",
				// Finance: payouts + transactions
				"GET /v1/finance/payout",
				"GET /v1/finance/transaction",
				// Markets: policies + taxonomy
				"GET|POST /v1/markets/policies/payment_policy",
				"GET|POST /v1/markets/policies/fulfillment_policy",
				"GET|POST /v1/markets/policies/return_policy",
				"GET /v1/markets/policies/privilege",
				"GET /v1/markets/taxonomy/get_default_category_tree_id",
				"GET /v1/markets/taxonomy/category_tree/{categoryTreeId}",
				"GET /v1/markets/taxonomy/category_tree/{categoryTreeId}/get_item_aspects_for_category",
				// flipagent: evaluate (single-listing judgment — Decisions pillar)
				"POST /v1/evaluate",
				"POST /v1/evaluate/signals",
				// flipagent: discover (rank deals across a search — Overnight pillar)
				"POST /v1/discover",
				// flipagent: ship (forwarder quote + provider catalog — Operations pillar)
				"POST /v1/ship/quote",
				"GET /v1/ship/providers",
				// flipagent: keys (programmatic API key management)
				"GET /v1/keys/me",
				"POST /v1/keys/revoke",
				// flipagent: connect (programmatic eBay OAuth handshake)
				"GET /v1/connect/ebay",
				"GET /v1/connect/ebay/callback",
				"GET /v1/connect/ebay/status",
				"DELETE /v1/connect/ebay",
				// flipagent: billing (Stripe; session-driven)
				"POST /v1/billing/checkout",
				"POST /v1/billing/portal",
				"POST /v1/billing/webhook",
				// flipagent: dashboard (session-driven; /api/auth/* handled by Better-Auth)
				"GET /v1/me",
				"GET /v1/me/usage",
				"GET /v1/me/usage/breakdown",
				"GET /v1/me/usage/recent",
				"GET /v1/me/keys",
				"POST /v1/me/keys",
				"DELETE /v1/me/keys/{id}",
				"GET /v1/me/ebay/connect",
				"GET /v1/me/ebay/status",
				"DELETE /v1/me/ebay/connect",
				"ALL /api/auth/*",
				// flipagent: ToS hygiene
				"POST /v1/takedown",
				// liveness
				"GET /healthz",
			],
		}),
);
