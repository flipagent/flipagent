/**
 * Read-side flipagent management tool: ask whether the current api key has
 * an eBay account connected. Useful for the agent to detect "I should ask
 * the user to run the OAuth handshake first" before calling sell-side tools.
 *
 * Per-marketplace by design — when Amazon / Mercari are wired we add
 * sibling tools (`flipagent_connect_amazon_status` etc.) instead of
 * stuffing a `marketplace` param onto a single one. Mirrors the SDK
 * shape `client.connect.<marketplace>.status()` (dots → underscores).
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const flipagentConnectStatusInput = Type.Object({});

export const flipagentConnectStatusDescription =
	"Check whether the configured FLIPAGENT_API_KEY has connected an eBay account. Calls GET /v1/connect/ebay/status. Returns { connected, ebayUserId?, scopes?, expiresAt? }. Use before sell-side tools (`flipagent_listings_*`, `flipagent_sales_*`, `flipagent_payouts_*`) to detect missing OAuth and prompt the user to run the handshake.";

export async function flipagentConnectStatusExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	if (!config.authToken) {
		return { error: "no_api_key", message: "Set FLIPAGENT_API_KEY in env." };
	}
	try {
		const client = getClient(config);
		return await client.connect.ebay.status();
	} catch (err) {
		const e = toApiCallError(err, "/v1/connect/ebay/status");
		return { error: "connect_ebay_status_failed", status: e.status, url: e.url, message: e.message };
	}
}
