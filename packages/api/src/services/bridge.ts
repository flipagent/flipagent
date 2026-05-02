/**
 * Builds the unified `{ oauth, bridge }` connect-status payload returned by
 * `/v1/connect/ebay/status` (api-key flow) and `/v1/me/ebay/status` (dashboard
 * session flow). Both surfaces share the same shape so dashboards, CLI,
 * extension, and SDK consumers agree on a single mental model:
 *
 *   - `oauth`   = server-side eBay token flipagent stores (drives sell-side
 *                 REST passthrough).
 *   - `bridge`  = browser-side access via the paired Chrome extension
 *                 (drives buy flows + private data fetching).
 *
 * Same eBay account is usually behind both — different access mechanisms.
 * "Most recent active bridge token for this api key" wins when a user has
 * paired multiple browsers.
 */

import type { EbayConnectBridge, EbayConnectOAuth, EbayConnectStatus } from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys, bridgeTokens, userEbayOauth } from "../db/schema.js";

const EMPTY_OAUTH: EbayConnectOAuth = {
	connected: false,
	ebayUserId: null,
	ebayUserName: null,
	scopes: [],
	accessTokenExpiresAt: null,
	connectedAt: null,
};
const EMPTY_BRIDGE: EbayConnectBridge = {
	paired: false,
	deviceName: null,
	lastSeenAt: null,
	ebayLoggedIn: false,
	ebayUserName: null,
	verifiedAt: null,
};

/** Bridge half: most-recent paired client + its reported eBay-login state. */
export async function bridgeStateForApiKey(apiKeyId: string): Promise<EbayConnectBridge> {
	const rows = await db
		.select({
			deviceName: bridgeTokens.deviceName,
			lastSeenAt: bridgeTokens.lastSeenAt,
			ebayLoggedIn: bridgeTokens.ebayLoggedIn,
			ebayUserName: bridgeTokens.ebayUserName,
			verifiedAt: bridgeTokens.verifiedAt,
		})
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.apiKeyId, apiKeyId), isNull(bridgeTokens.revokedAt)))
		.orderBy(desc(bridgeTokens.createdAt))
		.limit(1);
	const row = rows[0];
	if (!row) return EMPTY_BRIDGE;
	return {
		paired: true,
		deviceName: row.deviceName ?? null,
		lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
		ebayLoggedIn: row.ebayLoggedIn,
		ebayUserName: row.ebayUserName ?? null,
		verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
	};
}

/** OAuth half by api key. */
export async function oauthStateForApiKey(apiKeyId: string): Promise<EbayConnectOAuth> {
	const rows = await db
		.select({
			ebayUserId: userEbayOauth.ebayUserId,
			ebayUserName: userEbayOauth.ebayUserName,
			scopes: userEbayOauth.scopes,
			accessTokenExpiresAt: userEbayOauth.accessTokenExpiresAt,
			connectedAt: userEbayOauth.createdAt,
		})
		.from(userEbayOauth)
		.where(eq(userEbayOauth.apiKeyId, apiKeyId))
		.limit(1);
	const row = rows[0];
	if (!row) return EMPTY_OAUTH;
	return {
		connected: true,
		ebayUserId: row.ebayUserId,
		ebayUserName: row.ebayUserName,
		scopes: row.scopes.split(" ").filter(Boolean),
		accessTokenExpiresAt: row.accessTokenExpiresAt.toISOString(),
		connectedAt: row.connectedAt.toISOString(),
	};
}

/** OAuth half by user (most-recent binding across the user's keys). */
export async function oauthStateForUser(ownerEmail: string): Promise<EbayConnectOAuth> {
	const rows = await db
		.select({
			ebayUserId: userEbayOauth.ebayUserId,
			ebayUserName: userEbayOauth.ebayUserName,
			scopes: userEbayOauth.scopes,
			accessTokenExpiresAt: userEbayOauth.accessTokenExpiresAt,
			connectedAt: userEbayOauth.createdAt,
		})
		.from(userEbayOauth)
		.innerJoin(apiKeys, eq(apiKeys.id, userEbayOauth.apiKeyId))
		.where(and(eq(apiKeys.ownerEmail, ownerEmail), isNull(apiKeys.revokedAt)))
		.orderBy(desc(userEbayOauth.updatedAt))
		.limit(1);
	const row = rows[0];
	if (!row) return EMPTY_OAUTH;
	return {
		connected: true,
		ebayUserId: row.ebayUserId,
		ebayUserName: row.ebayUserName,
		scopes: row.scopes.split(" ").filter(Boolean),
		accessTokenExpiresAt: row.accessTokenExpiresAt.toISOString(),
		connectedAt: row.connectedAt.toISOString(),
	};
}

/** Full status — both halves at once. Used by both connect routes. */
export async function ebayConnectStatusForApiKey(apiKeyId: string): Promise<EbayConnectStatus> {
	const [oauth, bridge] = await Promise.all([oauthStateForApiKey(apiKeyId), bridgeStateForApiKey(apiKeyId)]);
	return { oauth, bridge };
}

export async function ebayConnectStatusForUser(
	ownerEmail: string,
	apiKeyId: string | null,
): Promise<EbayConnectStatus> {
	const [oauth, bridge] = await Promise.all([
		oauthStateForUser(ownerEmail),
		apiKeyId ? bridgeStateForApiKey(apiKeyId) : Promise.resolve(EMPTY_BRIDGE),
	]);
	return { oauth, bridge };
}
