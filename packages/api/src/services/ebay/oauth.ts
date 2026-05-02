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
import { decryptIfEncrypted, encryptSecret } from "../../auth/secret-envelope.js";
import { config, isEbayOAuthConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { type UserEbayOauth, userEbayOauth } from "../../db/schema.js";
import { fetchRetry } from "../../utils/fetch-retry.js";

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
	const res = await fetchRetry(`${config.EBAY_BASE_URL}/identity/v1/oauth2/token`, {
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
	const res = await fetchRetry(`${config.EBAY_BASE_URL}/identity/v1/oauth2/token`, {
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
 *
 * Tokens are stored under the secrets envelope (AES-256-GCM gated on
 * `SECRETS_ENCRYPTION_KEY`). Reads pass through `decryptIfEncrypted`
 * which tolerates legacy plaintext rows during the migration window —
 * any legacy row gets re-written enveloped on its next refresh.
 */
export async function getUserAccessToken(apiKeyId: string): Promise<string> {
	const binding = await getUserBinding(apiKeyId);
	if (!binding) throw new Error("not_connected");
	const accessPlain = decryptIfEncrypted(binding.accessToken) ?? "";
	if (binding.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
		return accessPlain;
	}
	const refreshPlain = decryptIfEncrypted(binding.refreshToken) ?? "";
	const refreshed = await refreshUserAccess(refreshPlain);
	const newExpires = new Date(Date.now() + refreshed.expires_in * 1000);
	await db
		.update(userEbayOauth)
		.set({
			accessToken: encryptSecret(refreshed.access_token),
			accessTokenExpiresAt: newExpires,
			updatedAt: new Date(),
		})
		.where(eq(userEbayOauth.id, binding.id));
	return refreshed.access_token;
}

/**
 * Disconnect-and-revoke for one api-key binding. The two disconnect
 * routes (`DELETE /v1/connect/ebay` and `DELETE /v1/me/ebay/connect`)
 * both want to:
 *
 *   1. snapshot the refresh token,
 *   2. delete the local row,
 *   3. best-effort revoke at eBay so the refresh token is invalidated
 *      upstream too.
 *
 * Centralised here so both routes share the order, the decryption
 * boundary, and the upstream-failure-doesn't-block-local-delete contract.
 * Returns whether an upstream revoke was attempted (the caller may
 * surface that to the user).
 */
export async function disconnectEbayBinding(apiKeyId: string): Promise<{ revokeAttempted: boolean }> {
	const [snap] = await db
		.select({ refreshToken: userEbayOauth.refreshToken })
		.from(userEbayOauth)
		.where(eq(userEbayOauth.apiKeyId, apiKeyId))
		.limit(1);
	await db.delete(userEbayOauth).where(eq(userEbayOauth.apiKeyId, apiKeyId));
	if (!snap?.refreshToken) return { revokeAttempted: false };
	const refreshPlain = decryptIfEncrypted(snap.refreshToken) ?? snap.refreshToken;
	await revokeUserRefreshToken(refreshPlain).catch((err) => {
		console.warn(`[ebay] upstream revoke failed for apiKey=${apiKeyId}:`, err);
	});
	return { revokeAttempted: true };
}

/**
 * Revoke a refresh token at eBay's end. eBay exposes the OAuth 2.0
 * RFC 7009 endpoint at `/identity/v1/oauth2/revoke`; the request is
 * authenticated with the same `client_id:client_secret` Basic header
 * we use for token exchange. Best-effort: callers must not block local
 * disconnect on an upstream failure (network, expired refresh, eBay
 * outage), so this throws on hard errors but the call site catches.
 */
export async function revokeUserRefreshToken(refreshToken: string): Promise<void> {
	if (!isEbayOAuthConfigured()) return;
	const auth = Buffer.from(`${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`).toString("base64");
	const body = new URLSearchParams({
		token: refreshToken,
		token_type_hint: "refresh_token",
	}).toString();
	const res = await fetch(`${config.EBAY_AUTH_URL}/identity/v1/oauth2/revoke`, {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	// RFC 7009: revocation endpoints SHOULD return 200 even when the token
	// is unknown or already revoked. Treat 200/204 as success and bubble
	// other statuses so the caller's catch can log + move on.
	if (res.status !== 200 && res.status !== 204) {
		const detail = await res.text().catch(() => "");
		throw new Error(`eBay revoke failed: ${res.status} ${detail}`);
	}
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
	const res = await fetchRetry(`${config.EBAY_BASE_URL}/identity/v1/oauth2/token`, {
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
	const res = await fetchRetry(`${identityBase}/commerce/identity/v1/user/`, {
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

/**
 * Look up the eBay username persisted at OAuth callback time. Used by
 * `/v1/feedback` (REST `commerce/feedback/v1` requires `user_id`,
 * which we serve as the connected seller's username).
 */
export async function getEbayUsernameForApiKey(apiKeyId: string): Promise<string | null> {
	const rows = await db
		.select({ ebayUserName: userEbayOauth.ebayUserName })
		.from(userEbayOauth)
		.where(eq(userEbayOauth.apiKeyId, apiKeyId))
		.limit(1);
	return rows[0]?.ebayUserName ?? null;
}
