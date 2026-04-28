/**
 * Read-side flipagent management tool: ask whether the current api key has
 * an eBay account connected. Useful for the agent to detect "I should ask
 * the user to run the OAuth handshake first" before calling sell-side tools.
 */

import { Type } from "@sinclair/typebox";
import type { Config } from "../config.js";

export const flipagentConnectStatusInput = Type.Object({});

export const flipagentConnectStatusDescription =
	"Check whether the configured FLIPAGENT_API_KEY has connected an eBay account. Returns { connected, ebayUserName?, scopes?, accessTokenExpiresAt? }.";

export async function flipagentConnectStatusExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	if (!config.authToken) {
		return { error: "no_api_key", message: "Set FLIPAGENT_API_KEY in env." };
	}
	const url = `${config.flipagentBaseUrl}/v1/connect/ebay/status`;
	try {
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${config.authToken}`, "User-Agent": config.userAgent },
		});
		if (!res.ok) {
			return { error: "connect_status_failed", status: res.status, url, message: await res.text() };
		}
		return await res.json();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { error: "connect_status_failed", url, message };
	}
}
