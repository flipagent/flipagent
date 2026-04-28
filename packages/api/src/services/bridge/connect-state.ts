/**
 * Shared helper for the `bridgeClient` + `buyerSession` sections of the
 * eBay connect-status response. Both `/v1/connect/ebay/status` (api-key
 * flow) and `/v1/me/ebay/status` (dashboard session flow) pull from the
 * same `bridge_tokens` rows so dashboards, CLI, and Chrome extension agree.
 *
 * "Most recent active bridge token for this api key" wins — a user with
 * multiple paired bridge clients (e.g. Chrome on two laptops) sees the
 * freshest one. Future: surface the full list when we add a clients table
 * to the dashboard.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { bridgeTokens } from "../../db/schema.js";

export interface ConnectAugment {
	bridgeClient: {
		paired: boolean;
		deviceName: string | null;
		lastSeenAt: string | null;
	};
	buyerSession: {
		loggedIn: boolean;
		ebayUserName: string | null;
		verifiedAt: string | null;
	};
}

const EMPTY: ConnectAugment = {
	bridgeClient: { paired: false, deviceName: null, lastSeenAt: null },
	buyerSession: { loggedIn: false, ebayUserName: null, verifiedAt: null },
};

export async function bridgeStateForApiKey(apiKeyId: string): Promise<ConnectAugment> {
	const rows = await db
		.select({
			deviceName: bridgeTokens.deviceName,
			lastSeenAt: bridgeTokens.lastSeenAt,
			buyerLoggedIn: bridgeTokens.buyerLoggedIn,
			buyerEbayUserName: bridgeTokens.buyerEbayUserName,
			buyerVerifiedAt: bridgeTokens.buyerVerifiedAt,
		})
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.apiKeyId, apiKeyId), isNull(bridgeTokens.revokedAt)))
		.orderBy(desc(bridgeTokens.createdAt))
		.limit(1);
	const row = rows[0];
	if (!row) return EMPTY;
	return {
		bridgeClient: {
			paired: true,
			deviceName: row.deviceName ?? null,
			lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
		},
		buyerSession: {
			loggedIn: row.buyerLoggedIn,
			ebayUserName: row.buyerEbayUserName ?? null,
			verifiedAt: row.buyerVerifiedAt ? row.buyerVerifiedAt.toISOString() : null,
		},
	};
}
