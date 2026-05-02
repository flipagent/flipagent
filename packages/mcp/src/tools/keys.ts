/**
 * Self-introspection tool — what's the current api key, and what
 * permissions does it carry. Useful first call before queueing any
 * work so the agent can short-circuit if usage is exhausted or the
 * key was revoked.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const keysMeInput = Type.Object({});

export const keysMeDescription =
	"Get the current api key's metadata — tier, monthly quota / used, expiry, owner, role. GET /v1/keys/me. Use as a first call to short-circuit if the key is revoked or out of quota.";

export async function keysMeExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.keys.me();
	} catch (err) {
		const e = toApiCallError(err, "/v1/keys/me");
		return { error: "keys_me_failed", status: e.status, url: e.url, message: e.message };
	}
}
