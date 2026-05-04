/**
 * Self-introspection tool — what's the current api key, and what
 * permissions does it carry. Useful first call before queueing any
 * work so the agent can short-circuit if usage is exhausted or the
 * key was revoked.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const keysMeInput = Type.Object({});

export const keysMeDescription =
	"Self-introspection on the configured api key. Calls GET /v1/keys/me. **When to use** — call once at session start (alongside `flipagent_get_capabilities`) so you can short-circuit if the key is revoked, expired, or out of monthly quota before queueing real work. **Inputs** — none. **Output** — `{ id, prefix, tier, role, owner, monthlyQuota, monthlyUsed, expiresAt, createdAt }`. Compare `monthlyUsed` to `monthlyQuota` to decide whether to budget; check `tier` for entitlements. **Prereqs** — `FLIPAGENT_API_KEY` set. **Example** — call with `{}` and read `monthlyQuota - monthlyUsed` to see remaining usage events for the calendar month.";

export async function keysMeExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.keys.me();
	} catch (err) {
		return toolErrorEnvelope(err, "keys_me_failed", "/v1/keys/me");
	}
}
