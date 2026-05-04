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

import { FeaturesResponse, Health } from "@flipagent/types";
import { sql } from "drizzle-orm";
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
import { db } from "../../db/client.js";
import { jsonResponse } from "../../utils/openapi.js";

export const v1HealthRoute = new Hono();

v1HealthRoute.get(
	"/",
	describeRoute({
		tags: ["System"],
		summary: "Liveness + Postgres ping",
		security: [],
		responses: {
			200: jsonResponse("Service healthy.", Health),
			503: jsonResponse("Degraded — DB unreachable.", Health),
		},
	}),
	async (c) => {
		const started = Date.now();
		let dbOk = false;
		let dbErr: string | undefined;
		try {
			await db.execute(sql`select 1`);
			dbOk = true;
		} catch (err) {
			dbErr = err instanceof Error ? err.message : String(err);
		}
		return c.json(
			{
				status: dbOk ? "ok" : "degraded",
				db: { ok: dbOk, error: dbErr },
				proxy: isScraperApiConfigured() ? "configured" : "missing",
				latencyMs: Date.now() - started,
				version: process.env.npm_package_version ?? "0.0.0",
				ts: new Date().toISOString(),
			},
			dbOk ? 200 : 503,
		);
	},
);

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
			orderApi: config.EBAY_ORDER_APPROVED,
			insightsApi: isInsightsApproved(),
			biddingApi: config.EBAY_BIDDING_APPROVED,
			scraperApi: isScraperApiConfigured(),
			betterAuth: isAuthConfigured(),
			googleOAuth: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
			email: isEmailConfigured(),
			stripe: isStripeConfigured(),
			llm: isLlmConfigured(),
		});
	},
);
