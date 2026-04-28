/**
 * /v1/me/ebay/* — session-driven eBay OAuth flow for the dashboard.
 *
 * Mounted as a child of /v1/me, so `requireSession` from the parent applies.
 * The user's most recently created active key receives the binding — that
 * matches the dashboard's mental model where the user "connects their eBay
 * account" once and all their keys benefit (the same eBay seller account).
 *
 *   GET    /v1/me/ebay/connect    → 302 to eBay authorize, callback returns to dashboard
 *   GET    /v1/me/ebay/status     → { connected, ebayUserName?, scopes?, … }
 *   DELETE /v1/me/ebay/connect    → drop the binding (eBay-side token NOT revoked)
 *
 * State + authorize-URL builder + redirect-target whitelist are shared with
 * the API-key flow via `auth/ebay-oauth-state.ts`.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { buildEbayAuthorizeUrl, rememberState, safeRedirectTarget } from "../../auth/ebay-oauth-state.js";
import { isEbayOAuthConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { apiKeys, userEbayOauth } from "../../db/schema.js";
import { bridgeStateForApiKey } from "../../services/bridge/connect-state.js";
import { errorResponse } from "../../utils/openapi.js";

export const meEbayRoute = new Hono();

/**
 * Pick the api key this user's eBay binding lives against. Most recent
 * un-revoked key wins. Returns null if the user has no active keys (the
 * dashboard prompts them to create one before the connect button enables).
 */
async function pickPrimaryKey(userEmail: string): Promise<string | null> {
	const rows = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(and(eq(apiKeys.ownerEmail, userEmail), isNull(apiKeys.revokedAt)))
		.orderBy(desc(apiKeys.createdAt))
		.limit(1);
	return rows[0]?.id ?? null;
}

meEbayRoute.get(
	"/connect",
	describeRoute({
		tags: ["Dashboard"],
		summary: "Start eBay OAuth handshake (dashboard / session flow)",
		description: "302 to eBay's consent page. Callback returns the browser to APP_URL/dashboard.",
		responses: {
			302: { description: "Redirect to eBay authorize." },
			400: errorResponse("Caller has no active API key — create one first."),
			401: errorResponse("Not signed in."),
			503: errorResponse("eBay OAuth env not configured."),
		},
	}),
	async (c) => {
		if (!isEbayOAuthConfigured()) {
			return c.json({ error: "ebay_not_configured" as const, message: "EBAY_CLIENT_ID/SECRET/RU_NAME unset." }, 503);
		}
		const user = c.var.user;
		const apiKeyId = await pickPrimaryKey(user.email);
		if (!apiKeyId) {
			return c.json(
				{
					error: "no_api_key" as const,
					message: "Create an API key first (POST /v1/me/keys), then click Connect again.",
				},
				400,
			);
		}
		const requestedRedirect = c.req.query("redirect");
		const state = rememberState(apiKeyId, safeRedirectTarget(requestedRedirect));
		return c.redirect(buildEbayAuthorizeUrl(state));
	},
);

meEbayRoute.get(
	"/status",
	describeRoute({
		tags: ["Dashboard"],
		summary: "eBay connection status for the signed-in user",
		responses: {
			200: { description: "Connection state for this user." },
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const apiKeyId = await pickPrimaryKey(user.email);
		const [rows, bridgeState] = await Promise.all([
			db
				.select({
					ebayUserId: userEbayOauth.ebayUserId,
					ebayUserName: userEbayOauth.ebayUserName,
					scopes: userEbayOauth.scopes,
					accessTokenExpiresAt: userEbayOauth.accessTokenExpiresAt,
					connectedAt: userEbayOauth.createdAt,
				})
				.from(userEbayOauth)
				.innerJoin(apiKeys, eq(apiKeys.id, userEbayOauth.apiKeyId))
				.where(and(eq(apiKeys.ownerEmail, user.email), isNull(apiKeys.revokedAt)))
				.orderBy(desc(userEbayOauth.updatedAt))
				.limit(1),
			apiKeyId
				? bridgeStateForApiKey(apiKeyId)
				: Promise.resolve({
						bridgeClient: { paired: false, deviceName: null, lastSeenAt: null },
						buyerSession: { loggedIn: false, ebayUserName: null, verifiedAt: null },
					}),
		]);
		const row = rows[0];
		if (!row) return c.json({ connected: false as const, ...bridgeState });
		return c.json({
			connected: true as const,
			ebayUserId: row.ebayUserId,
			ebayUserName: row.ebayUserName,
			scopes: row.scopes.split(" "),
			accessTokenExpiresAt: row.accessTokenExpiresAt.toISOString(),
			connectedAt: row.connectedAt.toISOString(),
			...bridgeState,
		});
	},
);

meEbayRoute.delete(
	"/connect",
	describeRoute({
		tags: ["Dashboard"],
		summary: "Disconnect eBay for the signed-in user",
		description: "Drops every userEbayOauth row whose api_key belongs to this user. Tokens are NOT revoked at eBay.",
		responses: {
			200: { description: "Local bindings removed." },
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const userKeys = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.ownerEmail, user.email));
		const ids = userKeys.map((k) => k.id);
		if (ids.length === 0) {
			return c.json({ status: "disconnected" as const, removed: 0 });
		}
		// Drop one at a time — drizzle's `inArray` import is overkill for this size.
		let removed = 0;
		for (const id of ids) {
			const result = (await db
				.delete(userEbayOauth)
				.where(eq(userEbayOauth.apiKeyId, id))
				.returning({ id: userEbayOauth.id })) as { id: string }[];
			removed += result.length;
		}
		return c.json({ status: "disconnected" as const, removed });
	},
);
