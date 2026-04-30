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
				// Buy — Browse (sourcing reads)
				"GET /v1/buy/browse/item_summary/search",
				"GET /v1/buy/browse/item/{itemId}",
				"GET /v1/buy/browse/item/get_items",
				"GET /v1/buy/browse/item/get_items_by_item_group",
				// Buy — Marketplace Insights (sold-listing lookup)
				"GET /v1/buy/marketplace_insights/item_sales/search",
				// Buy — Order (Limited Release; bridge-implemented for now)
				"POST /v1/buy/order/checkout_session/initiate",
				"GET /v1/buy/order/checkout_session/{sessionId}",
				"POST /v1/buy/order/checkout_session/{sessionId}/place_order",
				"GET /v1/buy/order/purchase_order/{purchaseOrderId}",
				"POST /v1/buy/order/guest_checkout_session/initiate",
				"GET /v1/buy/order/guest_checkout_session/{sessionId}",
				"POST /v1/buy/order/guest_checkout_session/{sessionId}/place_order",
				"GET /v1/buy/order/guest_purchase_order/{purchaseOrderId}",
				// Sell — Inventory (seller-side write, user OAuth)
				"PUT|GET|DELETE /v1/sell/inventory/inventory_item/{sku}",
				"POST|GET|PUT|DELETE /v1/sell/inventory/offer/{offerId}",
				"POST /v1/sell/inventory/offer/{offerId}/publish",
				"POST /v1/sell/inventory/location/{merchantLocationKey}",
				// Sell — Fulfillment (incoming orders, ship, refund)
				"GET /v1/sell/fulfillment/order",
				"POST /v1/sell/fulfillment/order/{orderId}/shipping_fulfillment",
				// Sell — Finances (payouts)
				"GET /v1/sell/finances/payout",
				"GET /v1/sell/finances/transaction",
				// Sell — Account (policies)
				"GET|POST /v1/sell/account/payment_policy",
				"GET|POST /v1/sell/account/fulfillment_policy",
				"GET|POST /v1/sell/account/return_policy",
				"GET /v1/sell/account/privilege",
				// Sell — Marketing / Negotiation / Analytics / etc. (catch-all passthroughs)
				"ALL /v1/sell/marketing/*",
				"ALL /v1/sell/negotiation/*",
				"ALL /v1/sell/analytics/*",
				"ALL /v1/sell/compliance/*",
				"ALL /v1/sell/recommendation/*",
				"ALL /v1/sell/logistics/*",
				"ALL /v1/sell/stores/*",
				"ALL /v1/sell/feed/*",
				"ALL /v1/sell/metadata/*",
				// Commerce — taxonomy + catalog + identity
				"GET /v1/commerce/taxonomy/get_default_category_tree_id",
				"GET /v1/commerce/taxonomy/category_tree/{categoryTreeId}",
				"GET /v1/commerce/taxonomy/category_tree/{categoryTreeId}/get_item_aspects_for_category",
				"ALL /v1/commerce/catalog/*",
				"GET /v1/commerce/identity/*",
				"POST /v1/commerce/translation/translate",
				// Post-order — returns / cases / cancellations
				"ALL /v1/post-order/*",
				// Trading XML wrappers (eBay has no REST equivalent)
				"GET /v1/messages",
				"POST /v1/messages/reply",
				"GET /v1/best-offer",
				"POST /v1/best-offer/respond",
				"GET /v1/feedback",
				"POST /v1/feedback/leave",
				// flipagent: forwarder package ops (bridge-driven, used in buy + sell)
				"POST /v1/forwarder/{provider}/refresh",
				"GET /v1/forwarder/{provider}/jobs/{jobId}",
				// flipagent: evaluate (single-listing judgment — Decisions pillar)
				// Sync POST + 4 queue-backed jobs surfaces (async create / poll / SSE
				// stream / cancel). Tab close mid-run keeps the worker running.
				"POST /v1/evaluate",
				"POST /v1/evaluate/jobs",
				"GET /v1/evaluate/jobs/{id}",
				"GET /v1/evaluate/jobs/{id}/stream",
				"POST /v1/evaluate/jobs/{id}/cancel",
				// flipagent: discover (rank deals across a search — Overnight pillar)
				// Same 5-route shape as evaluate.
				"POST /v1/discover",
				"POST /v1/discover/jobs",
				"GET /v1/discover/jobs/{id}",
				"GET /v1/discover/jobs/{id}/stream",
				"POST /v1/discover/jobs/{id}/cancel",
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
