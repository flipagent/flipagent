/**
 * Auth middleware for `/v1/bridge/*` routes that the bridge client hits.
 * Today the bridge client is the flipagent Chrome extension; the protocol
 * is generic so any client holding a valid bridge token works.
 *
 * Distinct from `requireApiKey` because:
 *   - the credential is a bridge token (`fbt_…`), not an api key (`fa_…`);
 *   - tier rate-limits don't apply (the bridge client runs in the user's
 *     own browser; metering happens at the api-key boundary);
 *   - we want the resolved api key + user id in context for queue lookups.
 */

import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { findActiveBridgeToken, touchBridgeToken } from "../auth/bridge-tokens.js";
import { db } from "../db/client.js";
import { type ApiKey, apiKeys, type BridgeToken } from "../db/schema.js";

declare module "hono" {
	interface ContextVariableMap {
		bridgeToken: BridgeToken;
		bridgeApiKey: ApiKey;
	}
}

function extract(authHeader: string | undefined): string | null {
	if (!authHeader) return null;
	if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
	return authHeader.trim() || null;
}

export const requireBridgeToken = createMiddleware(async (c, next) => {
	const plain = extract(c.req.header("Authorization"));
	if (!plain || !plain.startsWith("fbt_")) {
		return c.json({ error: "unauthorized", message: "Provide Authorization: Bearer fbt_…" }, 401);
	}
	const token = await findActiveBridgeToken(plain);
	if (!token) {
		return c.json({ error: "invalid_bridge_token", message: "Token not found or revoked." }, 401);
	}
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, token.apiKeyId)).limit(1);
	const key = rows[0];
	if (!key || key.revokedAt) {
		return c.json({ error: "invalid_bridge_token", message: "Underlying api key was revoked." }, 401);
	}
	c.set("bridgeToken", token);
	c.set("bridgeApiKey", key);
	await next();
	await touchBridgeToken(token.id).catch((err) => console.error("[bridge] touch failed:", err));
});
