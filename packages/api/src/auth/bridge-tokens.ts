/**
 * Bridge tokens — long-lived credentials handed to a bridge client.
 * Today's primary bridge client is the flipagent Chrome extension; the
 * protocol is generic so other clients (a future native helper, eBay's
 * Order API once approved) can plug into the same surface. One token
 * binds one client instance to one api key. Issuing requires a valid api
 * key; revoking the api key cascades.
 *
 * Format: `fbt_<24-byte-base64url>` (~36 chars). Plaintext is shown once
 * at issuance; only the sha256 hash persists. Mirrors the pattern in
 * `auth/keys.ts` so operators only have one mental model.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { type BridgeToken, bridgeTokens } from "../db/schema.js";

export interface GeneratedBridgeToken {
	plaintext: string;
	hash: string;
	prefix: string;
}

export function hashBridgeToken(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

export function generateBridgeToken(): GeneratedBridgeToken {
	const random = randomBytes(24).toString("base64url");
	const plaintext = `fbt_${random}`;
	return { plaintext, hash: hashBridgeToken(plaintext), prefix: plaintext.slice(0, 12) };
}

export interface IssueBridgeTokenInput {
	apiKeyId: string;
	userId: string | null;
	deviceName?: string;
}

export interface IssuedBridgeToken {
	id: string;
	plaintext: string;
	prefix: string;
	createdAt: string;
}

export async function issueBridgeToken(input: IssueBridgeTokenInput): Promise<IssuedBridgeToken> {
	const gen = generateBridgeToken();
	const [row] = await db
		.insert(bridgeTokens)
		.values({
			apiKeyId: input.apiKeyId,
			userId: input.userId,
			tokenHash: gen.hash,
			tokenPrefix: gen.prefix,
			deviceName: input.deviceName ?? null,
		})
		.returning();
	if (!row) throw new Error("bridgeTokens insert returned no row");
	return {
		id: row.id,
		plaintext: gen.plaintext,
		prefix: gen.prefix,
		createdAt: row.createdAt.toISOString(),
	};
}

export async function findActiveBridgeToken(plain: string): Promise<BridgeToken | null> {
	const hash = hashBridgeToken(plain);
	const rows = await db
		.select()
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.tokenHash, hash), isNull(bridgeTokens.revokedAt)))
		.limit(1);
	return rows[0] ?? null;
}

export async function touchBridgeToken(id: string): Promise<void> {
	await db.update(bridgeTokens).set({ lastSeenAt: new Date() }).where(eq(bridgeTokens.id, id));
}

export async function revokeBridgeToken(id: string): Promise<void> {
	await db.update(bridgeTokens).set({ revokedAt: new Date() }).where(eq(bridgeTokens.id, id));
}

/**
 * List active bridge tokens owned by a user. Powers the dashboard's
 * "Connected devices" list. Tokens belonging to a revoked api key are
 * already filtered by the cascade-on-revoke pattern + the `revokedAt`
 * column; we additionally guard with an `isNull(revokedAt)` to match
 * `findActiveBridgeToken`'s active-only contract.
 */
export async function listBridgeTokensForUser(userId: string): Promise<BridgeToken[]> {
	return db
		.select()
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.userId, userId), isNull(bridgeTokens.revokedAt)))
		.orderBy(desc(bridgeTokens.createdAt));
}

/**
 * Whether this api key has at least one active (non-revoked) bridge
 * token — i.e. a paired Chrome extension. Used by routes that pick a
 * transport per call to decide between bridge and url; cheap query
 * (one indexed lookup, no row materialisation).
 */
export async function isExtensionPaired(apiKeyId: string): Promise<boolean> {
	const rows = await db
		.select({ id: bridgeTokens.id })
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.apiKeyId, apiKeyId), isNull(bridgeTokens.revokedAt)))
		.limit(1);
	return rows.length > 0;
}

/**
 * Look up a single bridge token row by id, scoped to the owning user.
 * Returns null when missing or owned by someone else — callers (the
 * /v1/me/devices DELETE route) treat both as 404 to avoid leaking
 * existence of other users' rows.
 */
export async function getBridgeTokenForUser(id: string, userId: string): Promise<BridgeToken | null> {
	const rows = await db
		.select()
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.id, id), eq(bridgeTokens.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}
