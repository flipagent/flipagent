/**
 * Shared permissions computation. Both /v1/me/permissions (session auth) and
 * /v1/keys/permissions (api-key auth) need the same scope-status answers —
 * the only difference is how we find the user's eBay binding.
 *
 * Caller picks one of:
 *   computePermissionsForUser(ownerEmail) — looks across the user's keys,
 *                                            returns the most-recent binding
 *   computePermissionsForApiKey(apiKeyId) — reads the binding tied to one key
 *
 * The eBay-side state we have access to is:
 *   1. process env (is OAuth configured? is Order API approved? is Insights approved?)
 *   2. the user's stored scope list (granted at consent time)
 *
 * Both signals together determine each route's status.
 */

import type { PermissionsResponse, ScopeStatus } from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config, isEbayOAuthConfigured, isInsightsApproved } from "../config.js";
import { db } from "../db/client.js";
import { apiKeys, userEbayOauth } from "../db/schema.js";

type Binding = {
	ebayUserId: string | null;
	ebayUserName: string | null;
	scopes: string;
};

/**
 * eBay stores scopes as full URIs ("https://api.ebay.com/oauth/api_scope/sell.inventory");
 * suffix-match so this survives URL changes.
 */
function hasScope(scopes: string[], suffix: string): boolean {
	return scopes.some((s) => s.endsWith(suffix));
}

function buildResponse(binding: Binding | undefined): PermissionsResponse {
	const ebayConfigured = isEbayOAuthConfigured();
	const connected = Boolean(binding);
	const scopes = binding ? binding.scopes.split(" ").filter(Boolean) : [];

	// Browse: REST when host has app credentials, scrape otherwise.
	const browse: ScopeStatus = ebayConfigured ? "ok" : "scrape";

	// Marketplace Insights: REST passthrough only when eBay has approved the
	// tenant for the Insights program (EBAY_INSIGHTS_APPROVED=1). Without
	// approval we always scrape. The user's stored scope list is irrelevant —
	// Insights uses an app-level token, not user OAuth.
	const marketplaceInsights: ScopeStatus = isInsightsApproved() ? "ok" : "scrape";

	// User-OAuth-gated scopes: needs eBay configured + connected + the scope.
	function userScope(suffix: string): ScopeStatus {
		if (!ebayConfigured) return "unavailable";
		if (!connected) return "needs_oauth";
		return hasScope(scopes, suffix) ? "ok" : "needs_oauth";
	}

	// Order + Bidding APIs: both Limited Release per-program. eBay grants
	// each one independently, so we read separate env flags. Without
	// approval the status is "approval_pending" (eBay-side gate, not
	// something the user can fix); without `EBAY_CLIENT_ID/SECRET` at
	// all we report "unavailable" (host-side gate).
	const order: ScopeStatus = ebayConfigured ? (config.EBAY_ORDER_APPROVED ? "ok" : "approval_pending") : "unavailable";
	const bidding: ScopeStatus = ebayConfigured
		? config.EBAY_BIDDING_APPROVED
			? "ok"
			: "approval_pending"
		: "unavailable";

	return {
		ebayConnected: connected,
		ebayUserName: binding?.ebayUserName ?? null,
		ebayUserId: binding?.ebayUserId ?? null,
		scopes: {
			browse,
			marketplaceInsights,
			inventory: userScope("sell.inventory"),
			fulfillment: userScope("sell.fulfillment"),
			finance: userScope("sell.finances"),
			order,
			bidding,
		},
	};
}

/** Most-recent binding across all of this user's active keys. */
export async function computePermissionsForUser(ownerEmail: string): Promise<PermissionsResponse> {
	const rows = await db
		.select({
			ebayUserId: userEbayOauth.ebayUserId,
			ebayUserName: userEbayOauth.ebayUserName,
			scopes: userEbayOauth.scopes,
		})
		.from(userEbayOauth)
		.innerJoin(apiKeys, eq(apiKeys.id, userEbayOauth.apiKeyId))
		.where(and(eq(apiKeys.ownerEmail, ownerEmail), isNull(apiKeys.revokedAt)))
		.orderBy(desc(userEbayOauth.updatedAt))
		.limit(1);
	return buildResponse(rows[0]);
}

/** Binding tied specifically to one API key. */
export async function computePermissionsForApiKey(apiKeyId: string): Promise<PermissionsResponse> {
	const rows = await db
		.select({
			ebayUserId: userEbayOauth.ebayUserId,
			ebayUserName: userEbayOauth.ebayUserName,
			scopes: userEbayOauth.scopes,
		})
		.from(userEbayOauth)
		.where(eq(userEbayOauth.apiKeyId, apiKeyId))
		.limit(1);
	return buildResponse(rows[0]);
}
