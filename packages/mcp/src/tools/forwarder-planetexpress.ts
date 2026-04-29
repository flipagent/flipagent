/**
 * `planet_express_packages` — refresh the user's Planet Express
 * forwarder inbox via the bridge protocol. Backed by the unified
 * `/v1/forwarder/{provider}/*` surface.
 *
 * Two-step flow (mirrors how every bridge-driven read works):
 *   1. POST /v1/forwarder/planetexpress/refresh — queue a job
 *   2. GET  /v1/forwarder/planetexpress/jobs/{jobId} — poll until
 *      `status: "completed"` (or terminal).
 *
 * For one-shot ergonomics, this MCP tool calls `refresh` and returns
 * the `jobId` immediately. The agent should poll
 * `planet_express_packages_status` (TBD) until terminal — same async
 * pattern as eBay buy.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const planetExpressPackagesInput = Type.Object({});

export const planetExpressPackagesDescription =
	"Read the user's Planet Express forwarder inbox (packages awaiting consolidation, on-hand, or shipped). Calls POST /v1/forwarder/planetexpress/refresh — the bridge queues a `pull_packages` job and the user's flipagent Chrome extension reads the inbox from their logged-in PE session, then reports the package list back. Returns a `jobId` immediately; poll `GET /v1/forwarder/planetexpress/jobs/{jobId}` until terminal. Requires the user to be signed into planetexpress.com in the same Chrome profile the extension is paired with.";

export async function planetExpressPackagesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.forwarder.refresh({ provider: "planetexpress" });
	} catch (err) {
		const e = toApiCallError(err, "/v1/forwarder/planetexpress/refresh");
		return {
			error: "forwarder_refresh_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: "Sign into planetexpress.com in the Chrome profile your flipagent extension is paired with.",
		};
	}
}
