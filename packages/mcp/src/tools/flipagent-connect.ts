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
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const flipagentConnectStatusInput = Type.Object({});

export const flipagentConnectStatusDescription =
	'Check whether the configured api key has an eBay seller account connected. Calls GET /v1/connect/ebay/status. **When to use** — narrow alternative to `flipagent_get_capabilities` when you only need to know "is eBay OAuth done?" — e.g. before a sell-side action. Most agents should prefer `flipagent_get_capabilities` (richer per-marketplace state). **Inputs** — none. **Output** — `{ connected: boolean, ebayUserId?, scopes?: string[], expiresAt?: ISO }`. When `connected: false`, ask the user to visit `/v1/connect/ebay` (any sell-side tool\'s `next_action.url` will carry the absolute URL on 401). **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — call with `{}` before queueing `flipagent_create_listing`.';

export async function flipagentConnectStatusExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	if (!config.authToken) {
		return { error: "no_api_key", message: "Set FLIPAGENT_API_KEY in env." };
	}
	try {
		const client = getClient(config);
		return await client.connect.ebay.status();
	} catch (err) {
		return toolErrorEnvelope(err, "connect_ebay_status_failed", "/v1/connect/ebay/status");
	}
}
