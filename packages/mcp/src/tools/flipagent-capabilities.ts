/**
 * `flipagent_capabilities` — agent's first call. Returns the per-marketplace
 * capability map (search/sold/detail/evaluate/buy/sell × ebay/…) and the
 * bridge-client (Chrome extension) state. Lets the agent decide which
 * tools are even worth attempting and surface the right remediation
 * (sign in, OAuth handshake, install extension) when something is missing.
 *
 * Replaces the narrower `flipagent_connect_ebay_status` for new code; that
 * tool stays for back-compat but its description points here.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const flipagentCapabilitiesInput = Type.Object({});

export const flipagentCapabilitiesDescription =
	'Read what works for the configured api key right now. Returns `client.extensionPaired`, `client.lastSeenAt`, and a `marketplaces` map keyed by marketplace id; each has `search`, `sold`, `detail`, `evaluate`, `buy`, `sell` with statuses `ok | needs_signin | needs_oauth | approval_pending | scrape | unavailable`. Call this first; choose subsequent tools based on what\'s `ok`. When `marketplaces.ebay.buy === "needs_signin"`, ask the user to install the flipagent Chrome extension and sign into eBay before calling `flipagent_purchases_create`.';

export async function flipagentCapabilitiesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.capabilities.get();
	} catch (err) {
		const e = toApiCallError(err, "/v1/capabilities");
		return {
			error: "capabilities_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: e.status === 401 ? "Set FLIPAGENT_API_KEY." : undefined,
		};
	}
}
