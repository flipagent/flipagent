import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const shipProvidersInput = Type.Object({});

export const shipProvidersDescription =
	"List the forwarder providers flipagent supports for /v1/ship/quote. Calls GET /v1/ship/providers. Each entry exposes per-package handling, consolidation fees, dim-weight divisor, and the carrier services it routes through. Use this before calling `flipagent_ship_quote` when you want the agent to pick a provider explicitly.";

export async function shipProvidersExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.ship.providers();
	} catch (err) {
		const e = toApiCallError(err, "/v1/ship/providers");
		return { error: "ship_providers_failed", status: e.status, message: e.message, url: e.url };
	}
}
