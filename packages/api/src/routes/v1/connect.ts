/**
 * /v1/connect/ebay/* — handshake to bind an api key to its operator's eBay
 * account (API-key-driven flow; for SDK / programmatic callers).
 *
 *   1. `GET  /v1/connect/ebay` — caller (with API key) is redirected to
 *      eBay's authorize page; we stash a CSRF state keyed to their api-key id.
 *   2. `GET  /v1/connect/ebay/callback` — eBay redirects here with `?code=`.
 *      We exchange code → tokens, upsert `user_ebay_oauth`, and 302 the
 *      browser to the dashboard with `?ebay=connected|error`.
 *   3. `DELETE /v1/connect/ebay` — drop the binding for that api key.
 *
 *   `GET /v1/connect/ebay/status` returns binding state (no secrets).
 *
 * Dashboard (session-driven) flow lives in `me-ebay.ts` and shares the
 * state store via `services/ebay/oauth-state.ts`.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config, isEbayOAuthConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { userEbayOauth } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { ebayConnectStatusForApiKey } from "../../services/bridge.js";
import { exchangeCode, fetchEbayUserSummary } from "../../services/ebay/oauth.js";
import {
	buildEbayAuthorizeUrl,
	consumeState,
	rememberState,
	safeRedirectTarget,
} from "../../services/ebay/oauth-state.js";
import { errorResponse } from "../../utils/openapi.js";

export const connectRoute = new Hono();

connectRoute.get(
	"/ebay",
	describeRoute({
		tags: ["OAuth"],
		summary: "Start eBay OAuth handshake (API-key flow)",
		description: "Redirects the caller's browser to eBay's consent page. Caller must include a valid API key.",
		responses: {
			302: { description: "Redirect to eBay authorize." },
			401: errorResponse("Missing or invalid API key."),
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isEbayOAuthConfigured()) {
			return c.json({ error: "ebay_not_configured" as const, message: "EBAY_CLIENT_ID/SECRET/RU_NAME unset." }, 503);
		}
		const apiKey = c.get("apiKey");
		const requestedRedirect = c.req.query("redirect");
		const state = rememberState(apiKey.id, safeRedirectTarget(requestedRedirect));
		return c.redirect(buildEbayAuthorizeUrl(state));
	},
);

connectRoute.get(
	"/ebay/callback",
	describeRoute({
		tags: ["OAuth"],
		summary: "eBay OAuth callback",
		description:
			"eBay redirects here with `?code=`. Exchanges code, stores tokens, then 302s the browser to the dashboard.",
		responses: {
			302: { description: "Redirect to APP_URL/dashboard?ebay=connected|error." },
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	async (c) => {
		const fallbackUrl = `${config.APP_URL.replace(/\/+$/, "")}/dashboard`;
		const errRedirect = (msg: string) => c.redirect(`${fallbackUrl}?ebay=error&message=${encodeURIComponent(msg)}`);

		if (!isEbayOAuthConfigured()) {
			return errRedirect("eBay OAuth not configured on this api instance.");
		}
		const code = c.req.query("code");
		const state = c.req.query("state");
		const errParam = c.req.query("error");
		if (errParam) {
			return errRedirect(`eBay declined consent: ${errParam}`);
		}
		if (!code || !state) {
			return errRedirect("Callback missing code or state.");
		}
		const pending = consumeState(state);
		if (!pending) {
			return errRedirect("Connect link expired. Please try again.");
		}

		let tokens: Awaited<ReturnType<typeof exchangeCode>>;
		try {
			tokens = await exchangeCode(code);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return errRedirect(`Token exchange failed: ${message}`);
		}

		const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
		const refreshTokenExpiresAt = tokens.refresh_token_expires_in
			? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
			: null;

		const summary = await fetchEbayUserSummary(tokens.access_token).catch(() => null);

		await db
			.insert(userEbayOauth)
			.values({
				apiKeyId: pending.apiKeyId,
				ebayUserId: summary?.userId ?? null,
				ebayUserName: summary?.username ?? null,
				accessToken: tokens.access_token,
				accessTokenExpiresAt,
				refreshToken: tokens.refresh_token,
				refreshTokenExpiresAt,
				scopes: config.EBAY_SCOPES,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: userEbayOauth.apiKeyId,
				set: {
					ebayUserId: summary?.userId ?? null,
					ebayUserName: summary?.username ?? null,
					accessToken: tokens.access_token,
					accessTokenExpiresAt,
					refreshToken: tokens.refresh_token,
					refreshTokenExpiresAt,
					scopes: config.EBAY_SCOPES,
					updatedAt: new Date(),
				},
			});

		const successUrl = new URL(pending.redirectAfter);
		successUrl.searchParams.set("ebay", "connected");
		if (summary?.username) successUrl.searchParams.set("user", summary.username);
		return c.redirect(successUrl.toString());
	},
);

connectRoute.get(
	"/ebay/status",
	describeRoute({
		tags: ["OAuth"],
		summary: "Get current eBay connection status (API-key flow)",
		responses: {
			200: { description: "Connection state for the caller's api key." },
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const apiKey = c.get("apiKey");
		const status = await ebayConnectStatusForApiKey(apiKey.id);
		return c.json(status);
	},
);

connectRoute.delete(
	"/ebay",
	describeRoute({
		tags: ["OAuth"],
		summary: "Disconnect eBay account (API-key flow)",
		responses: {
			200: { description: "Local binding removed." },
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const apiKey = c.get("apiKey");
		await db.delete(userEbayOauth).where(eq(userEbayOauth.apiKeyId, apiKey.id));
		return c.json({ status: "disconnected" as const });
	},
);
