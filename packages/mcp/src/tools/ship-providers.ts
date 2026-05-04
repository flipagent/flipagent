import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const shipProvidersInput = Type.Object({});

export const shipProvidersDescription =
	"List the forwarder providers flipagent supports for `flipagent_quote_shipping`. Calls GET /v1/ship/providers. **When to use** — only when you need to pick a non-default forwarder explicitly (e.g. the user asked for Planet Express specifically, or you're comparing providers). For typical agent workflows, skip this and let `flipagent_quote_shipping` use the default. **Inputs** — none. **Output** — `{ providers: [{ id, name, perPackageHandlingCents, consolidationCents, dimWeightDivisor, carrierServices: [...] }] }`. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — call with `{}`, then pass the chosen `provider` id into `flipagent_quote_shipping`.";

export async function shipProvidersExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.ship.providers();
	} catch (err) {
		return toolErrorEnvelope(err, "ship_providers_failed", "/v1/ship/providers");
	}
}
