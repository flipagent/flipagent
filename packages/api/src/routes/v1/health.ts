/**
 * /v1/health/* — public capability surface.
 *
 *   GET /v1/health/features → which optional features are wired on this host
 *
 * Used by:
 *   1. Dashboard (apps/docs) — hide panels for unconfigured features so
 *      self-hosted instances don't show broken Stripe/eBay buttons.
 *   2. SDK consumers — preflight check before calling /v1/billing or
 *      /v1/me/ebay/connect (returns 503 when env unset).
 *   3. Docs site — render the "what works at each config level" matrix.
 *
 * Public + unauth: knowing which features are wired is fine; the actual
 * routes still gate access. Cheap (no DB hit), env-only, safe to call often.
 */

import { FeaturesResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
	config,
	isAuthConfigured,
	isEbayOAuthConfigured,
	isEmailConfigured,
	isInsightsApproved,
	isLlmConfigured,
	isScraperApiConfigured,
	isStripeConfigured,
} from "../../config.js";
import { jsonResponse } from "../../utils/openapi.js";

export const v1HealthRoute = new Hono();

v1HealthRoute.get(
	"/features",
	describeRoute({
		tags: ["System"],
		summary: "Which optional features are wired on this host",
		description:
			"Public capability snapshot. Lets the dashboard hide panels and lets self-hosters confirm their env without hitting the gated routes (which return 503).",
		security: [],
		responses: {
			200: jsonResponse("Feature flags.", FeaturesResponse),
		},
	}),
	(c) => {
		return c.json({
			ebayOAuth: isEbayOAuthConfigured(),
			orderApi: config.EBAY_ORDER_API_APPROVED,
			insightsApi: isInsightsApproved(),
			scraperApi: isScraperApiConfigured(),
			betterAuth: isAuthConfigured(),
			googleOAuth: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
			email: isEmailConfigured(),
			stripe: isStripeConfigured(),
			llm: isLlmConfigured(),
		});
	},
);
