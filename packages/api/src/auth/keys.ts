/**
 * API key generation, hashing, lookup, revocation. Plaintext is shown to
 * the user exactly once at creation; the database stores only the sha256
 * digest. `keyPrefix` is the first 12 plaintext characters and `keySuffix`
 * is the last 4 — together they let dashboards render `prefix···suffix`
 * for at-a-glance recognition without exposing the secret middle.
 *
 * Format: `fa_<tier>_<24-byte-base64url>` (40-44 chars total — base64url
 * of 24 bytes is 32 chars, plus `fa_` (3) plus the tier name (4-8) plus
 * the separator (1)).
 */

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { type ApiKey, apiKeys } from "../db/schema.js";
import { encryptKeyPlaintext, isKeyRevealConfigured } from "./key-cipher.js";

export type Tier = "free" | "hobby" | "standard" | "growth";

export interface GeneratedKey {
	plaintext: string;
	hash: string;
	prefix: string;
	suffix: string;
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
		suffix: plaintext.slice(-4),
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
	suffix: string;
	tier: Tier;
}

export async function issueKey(input: IssueKeyInput): Promise<IssuedKey> {
	const gen = generateKey(input.tier);
	const ciphertext = isKeyRevealConfigured() ? encryptKeyPlaintext(gen.plaintext) : null;
	const [row] = await db
		.insert(apiKeys)
		.values({
			keyHash: gen.hash,
			keyPrefix: gen.prefix,
			keySuffix: gen.suffix,
			keyCiphertext: ciphertext,
			tier: input.tier,
			name: input.name,
			ownerEmail: input.ownerEmail,
			userId: input.userId,
		})
		.returning();
	if (!row) throw new Error("apiKeys insert returned no row");
	return { id: row.id, plaintext: gen.plaintext, prefix: gen.prefix, suffix: gen.suffix, tier: row.tier };
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
