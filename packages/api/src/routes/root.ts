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
				// Marketplace data (read)
				"GET /v1/items/search",
				"GET /v1/items/{id}",
				"GET /v1/categories",
				"GET /v1/categories/suggest",
				"GET /v1/categories/{id}/aspects",
				"GET /v1/products/{epid}",
				"GET /v1/products/search",
				// My side (write)
				"POST /v1/listings",
				"GET /v1/listings",
				"GET|PATCH|DELETE /v1/listings/{sku}",
				"POST /v1/listings/{sku}/relist",
				"POST /v1/purchases",
				"GET /v1/purchases",
				"GET /v1/purchases/{id}",
				"POST /v1/purchases/{id}/cancel",
				"GET /v1/sales",
				"GET /v1/sales/{id}",
				"POST /v1/sales/{id}/ship",
				"POST /v1/sales/{id}/refund",
				// Money + comms + disputes
				"GET /v1/payouts",
				"GET /v1/transactions",
				"GET /v1/messages",
				"POST /v1/messages",
				"GET /v1/offers",
				"POST /v1/offers/{id}/respond",
				"GET /v1/feedback",
				"POST /v1/feedback",
				"GET /v1/disputes",
				"GET /v1/disputes/{id}",
				"POST /v1/disputes/{id}/respond",
				"GET /v1/policies",
				"GET /v1/policies/{type}",
				// Thin alias surfaces (eBay-shape, low-frequency)
				"ALL /v1/promotions/*",
				"ALL /v1/ads/*",
				"ALL /v1/store/*",
				"ALL /v1/analytics/*",
				"ALL /v1/feeds/*",
				"ALL /v1/bids/*",
				"ALL /v1/translate/*",
				"ALL /v1/labels/*",
				"ALL /v1/featured/*",
				// Raw escape hatch
				"ALL /v1/raw/ebay/*",
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
