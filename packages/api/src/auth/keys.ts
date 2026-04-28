/**
 * API key generation, hashing, lookup, revocation. Plaintext is shown to
 * the user exactly once at creation; the database stores only the sha256
 * digest. `keyPrefix` is the first 12 plaintext characters for display.
 *
 * Format: `fa_<tier>_<24-byte-base64url>` (~38 chars).
 */

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { type ApiKey, apiKeys } from "../db/schema.js";

export type Tier = "free" | "hobby" | "pro" | "business";

export interface GeneratedKey {
	plaintext: string;
	hash: string;
	prefix: string;
}

export function hashKey(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

export function generateKey(tier: Tier): GeneratedKey {
	const random = randomBytes(24).toString("base64url");
	const plaintext = `fa_${tier}_${random}`;
	return {
		plaintext,
		hash: hashKey(plaintext),
		prefix: plaintext.slice(0, 12),
	};
}

export interface IssueKeyInput {
	tier: Tier;
	name?: string;
	ownerEmail?: string;
	userId?: string;
}

export interface IssuedKey {
	id: string;
	plaintext: string;
	prefix: string;
	tier: Tier;
}

export async function issueKey(input: IssueKeyInput): Promise<IssuedKey> {
	const gen = generateKey(input.tier);
	const [row] = await db
		.insert(apiKeys)
		.values({
			keyHash: gen.hash,
			keyPrefix: gen.prefix,
			tier: input.tier,
			name: input.name,
			ownerEmail: input.ownerEmail,
			userId: input.userId,
		})
		.returning();
	if (!row) throw new Error("apiKeys insert returned no row");
	return { id: row.id, plaintext: gen.plaintext, prefix: gen.prefix, tier: row.tier };
}

/**
 * Look up an API key by plaintext. Returns the row or null. A revoked key
 * (revokedAt set) is treated as not found.
 */
export async function findActiveKey(plain: string): Promise<ApiKey | null> {
	const hash = hashKey(plain);
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
	const row = rows[0];
	if (!row || row.revokedAt) return null;
	return row;
}

export async function touchLastUsed(id: string): Promise<void> {
	await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
}

export async function revokeKey(id: string): Promise<void> {
	await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
}
