/**
 * eBay OAuth helpers — both flows.
 *
 *   1. **App-credential** (`client_credentials`) — for endpoints that don't
 *      need a user (Browse, Marketplace Insights, Commerce Taxonomy).
 *      flipagent fetches one app token, caches it ~110 minutes, reuses for
 *      every request.
 *   2. **User authorization** (`authorization_code` + `refresh_token`) — for
 *      endpoints that act as a specific seller/buyer (every `/sell/*`, the
 *      Order API). Stored per api-key in `user_ebay_oauth`; access tokens
 *      auto-refreshed when within 60s of expiry.
 *
 * eBay docs:
 *   - Authorize URL: https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html
 *   - Token URL:     https://developer.ebay.com/api-docs/static/oauth-token-request.html
 *
 * The `EBAY_RU_NAME` field is eBay's redirect identifier (not a URL — looks
 * like `MyApp-MyApp-PRD-abc-defg`). The actual callback URL is configured
 * inside eBay's developer portal under that RuName.
 */

import { eq } from "drizzle-orm";
import { config, isEbayOAuthConfigured } from "../config.js";
import { db } from "../db/client.js";
import { type UserEbayOauth, userEbayOauth } from "../db/schema.js";

interface CachedAppToken {
	token: string;
	expiresAt: number;
}

let cachedAppToken: CachedAppToken | null = null;

/** Authorize URL the connect-flow redirects the user's browser to. */
export function buildAuthorizeUrl(state: string): string {
	if (!isEbayOAuthConfigured()) throw new Error("eBay OAuth not configured");
	const params = new URLSearchParams({
		client_id: config.EBAY_CLIENT_ID!,
		response_type: "code",
		redirect_uri: config.EBAY_RU_NAME!,
		scope: config.EBAY_SCOPES,
		state,
	});
	return `${config.EBAY_AUTH_URL}/oauth2/authorize?${params}`;
}

interface CodeExchangeResponse {
	access_token: string;
	expires_in: number;
	refresh_token: string;
	refresh_token_expires_in: number;
	token_type: "User Access Token";
}

/** Exchange an authorization code (callback `?code=`) for refresh + access tokens. */
export async function exchangeCode(code: string): Promise<CodeExchangeResponse> {
	if (!isEbayOAuthConfigured()) throw new Error("eBay OAuth not configured");
	const auth = Buffer.from(`${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`).toString("base64");
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: config.EBAY_RU_NAME!,
	}).toString();
	const res = await fetch(`${config.EBAY_BASE_URL}/identity/v1/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) {
		const detail = await res.text();
		throw new Error(`eBay code exchange failed: ${res.status} ${detail}`);
	}
	return (await res.json()) as CodeExchangeResponse;
}

interface RefreshResponse {
	access_token: string;
	expires_in: number;
	token_type: "User Access Token";
}

async function refreshUserAccess(refreshToken: string): Promise<RefreshResponse> {
	if (!isEbayOAuthConfigured()) throw new Error("eBay OAuth not configured");
	const auth = Buffer.from(`${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`).toString("base64");
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		scope: config.EBAY_SCOPES,
	}).toString();
	const res = await fetch(`${config.EBAY_BASE_URL}/identity/v1/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) {
		const detail = await res.text();
		throw new Error(`eBay refresh failed: ${res.status} ${detail}`);
	}
	return (await res.json()) as RefreshResponse;
}

/**
 * Look up the stored binding for an api key. Returns `null` if not connected.
 * Caller should check the return and surface 401 not_connected to the user.
 */
export async function getUserBinding(apiKeyId: string): Promise<UserEbayOauth | null> {
	const rows = await db.select().from(userEbayOauth).where(eq(userEbayOauth.apiKeyId, apiKeyId)).limit(1);
	return rows[0] ?? null;
}

/**
 * Fresh access token for the api-key's connected eBay account. Refreshes the
 * stored access token if it's within 60s of expiry. Throws `not_connected`
 * if no binding exists.
 */
export async function getUserAccessToken(apiKeyId: string): Promise<string> {
	const binding = await getUserBinding(apiKeyId);
	if (!binding) throw new Error("not_connected");
	if (binding.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
		return binding.accessToken;
	}
	const refreshed = await refreshUserAccess(binding.refreshToken);
	const newExpires = new Date(Date.now() + refreshed.expires_in * 1000);
	await db
		.update(userEbayOauth)
		.set({
			accessToken: refreshed.access_token,
			accessTokenExpiresAt: newExpires,
			updatedAt: new Date(),
		})
		.where(eq(userEbayOauth.id, binding.id));
	return refreshed.access_token;
}

/**
 * App-credential token (no user). 7200s TTL upstream; we cache a bit shorter
 * (110 minutes) to leave margin for clock skew. Used for Browse, Insights,
 * and Commerce Taxonomy passthroughs.
 */
export async function getAppAccessToken(): Promise<string> {
	if (!isEbayOAuthConfigured()) throw new Error("eBay OAuth not configured");
	if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 60_000) {
		return cachedAppToken.token;
	}
	const auth = Buffer.from(`${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`).toString("base64");
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		scope: "https://api.ebay.com/oauth/api_scope",
	}).toString();
	const res = await fetch(`${config.EBAY_BASE_URL}/identity/v1/oauth2/token`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) {
		const detail = await res.text();
		throw new Error(`eBay app token failed: ${res.status} ${detail}`);
	}
	const json = (await res.json()) as { access_token: string; expires_in: number };
	cachedAppToken = {
		token: json.access_token,
		expiresAt: Date.now() + Math.min(json.expires_in, 110 * 60) * 1000,
	};
	return json.access_token;
}

/** Fetch the connected user's eBay username, used after callback to label the binding. */
export async function fetchEbayUserSummary(accessToken: string): Promise<{ userId: string; username: string } | null> {
	// Identity API lives on apiz.ebay.com (note the 'z'), not api.ebay.com,
	// the path requires a trailing slash, and X-EBAY-C-MARKETPLACE-ID is
	// mandatory. Any one of those missing → 404 with empty body.
	const identityBase = config.EBAY_BASE_URL.replace(/^https?:\/\/api\./, "https://apiz.");
	const res = await fetch(`${identityBase}/commerce/identity/v1/user/`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
		},
	});
	if (!res.ok) return null;
	const json = (await res.json()) as { userId?: string; username?: string };
	return { userId: json.userId ?? "", username: json.username ?? "" };
}

/** For unit tests / dev — clears the cached app token. */
export function _resetAppTokenCache() {
	cachedAppToken = null;
}
