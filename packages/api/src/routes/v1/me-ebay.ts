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
 * the API-key flow via `services/ebay/oauth-state.ts`.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { EBAY_CONNECT_DISCLAIMER_VERSION } from "../../auth/legal-versions.js";
import { isEbayOAuthConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { apiKeys } from "../../db/schema.js";
import { ebayConnectStatusForUser } from "../../services/bridge.js";
import { disconnectEbayBinding } from "../../services/ebay/oauth.js";
import { buildEbayAuthorizeUrl, rememberState, safeRedirectTarget } from "../../services/ebay/oauth-state.js";
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
		// JIT consent gate — same disclosure version as the API-key flow.
		// The dashboard surfaces a modal that POSTs the user through with
		// `?ack=<version>`; programmatic callers should do the same.
		const ack = c.req.query("ack");
		if (ack !== EBAY_CONNECT_DISCLAIMER_VERSION) {
			return c.json(
				{
					error: "disclaimer_not_acknowledged" as const,
					message:
						"Acknowledge the eBay-connect disclosure before proceeding. Re-issue this request with `?ack=" +
						EBAY_CONNECT_DISCLAIMER_VERSION +
						"`.",
					disclosureVersion: EBAY_CONNECT_DISCLAIMER_VERSION,
				},
				412,
			);
		}
		const requestedRedirect = c.req.query("redirect");
		const state = rememberState(apiKeyId, safeRedirectTarget(requestedRedirect), {
			version: EBAY_CONNECT_DISCLAIMER_VERSION,
		});
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
		const status = await ebayConnectStatusForUser(user.email, apiKeyId);
		return c.json(status);
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
		// One snapshot+delete+revoke per binding via the shared helper, so
		// the order + decryption boundary + best-effort upstream-revoke
		// contract live in one place.
		let removed = 0;
		for (const id of ids) {
			const { revokeAttempted } = await disconnectEbayBinding(id);
			if (revokeAttempted) removed += 1;
		}
		return c.json({ status: "disconnected" as const, removed });
	},
);
