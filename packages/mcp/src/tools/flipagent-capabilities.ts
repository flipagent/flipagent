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
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const flipagentCapabilitiesInput = Type.Object({});

export const flipagentCapabilitiesDescription =
	"Discover what the configured api key can actually do *right now*, and what setup the user needs to complete next. Calls GET /v1/capabilities. **When to use** — your first call after the MCP connects, AND any time another tool returns a `needs_*` status or a 401/403 with `next_action`. **Inputs** — none. **Output** — `{ client, marketplaces, forwarders, setup, checklist }`. The `checklist` is the canonical onboarding source of truth (same 3 rows the dashboard + extension popup show): `{ steps: [{ id, status: 'done'|'active'|'locked', required: true, title, description, unlocks }], nextStep: id|null, allRequiredDone: boolean }`. Step ids: `pair_extension | ebay_signin | seller_oauth` — every step is required for the canonical resell loop. **Decision rules**: prefer `checklist.nextStep` for guidance — surface that step's `description` to the user with the matching action URL: `pair_extension` → `${setup.dashboardUrl}/extension/connect/` (or `setup.extensionInstall` for the install bundle), `ebay_signin` → `https://www.ebay.com/` (sign in there), `seller_oauth` → `${setup.dashboardUrl}/dashboard/?connect=ebay`. Per-capability flags: `scrape` = slower fallback path, `unavailable` = don't bother attempting, `needs_signin`/`needs_oauth` = re-check checklist. **Forwarder note** — `forwarders.planetexpress` is intentionally NOT a setup step. Planet Express is browser-session bound and expires within ~30 min idle; the user re-signs in on demand. If a `/v1/forwarder/*` call fails with `failureReason: planetexpress_signed_out`, surface the `next_action.url` to the user (the response carries it) and re-call the tool — don't pre-emptively prompt the user to sign in to PE before they actually need it. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — call at session start; if `checklist.allRequiredDone` is false, prompt the user with `checklist.steps.find(s => s.id === checklist.nextStep).description`.";

export async function flipagentCapabilitiesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.capabilities.get();
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"get_capabilities_failed",
			"/v1/capabilities",
			"If 401, set FLIPAGENT_API_KEY in this MCP server's environment.",
		);
	}
}
