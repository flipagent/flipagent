/**
 * AES-256-GCM encryption for API key plaintext at rest.
 *
 * The `api_keys.key_ciphertext` column stores the issued plaintext encrypted
 * with `KEYS_ENCRYPTION_KEY` so the dashboard can reveal the full key on
 * demand. The sha256 `key_hash` is still what authenticates incoming
 * requests — this column is purely for display.
 *
 * Format on disk: `<base64 iv>:<base64 ciphertext+gcm-tag>` (tag is the
 * trailing 16 bytes of the second segment, per node:crypto convention).
 *
 * Threat model: the column lets an operator with both DB and env access
 * recover plaintext — same trust boundary as a session secret. A DB-only
 * leak (without env) cannot decrypt because the AES key isn't there.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALG = "aes-256-gcm";
const TAG_BYTES = 16;
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function deriveDevFallback(): Buffer {
	const seed = config.BETTER_AUTH_SECRET ?? "flipagent-dev-fallback";
	return createHash("sha256").update(`keys-encryption:${seed}`).digest();
}

/**
 * Returns the 32-byte AES key. Production requires `KEYS_ENCRYPTION_KEY`
 * (base64, 32 bytes after decoding). Dev/test silently derives one from
 * `BETTER_AUTH_SECRET` so local setups don't break — those keys are not
 * portable across environments, which is the point.
 */
export function getKeysEncryptionKey(): Buffer {
	if (cachedKey) return cachedKey;
	const env = config.KEYS_ENCRYPTION_KEY;
	if (env) {
		const buf = Buffer.from(env, "base64");
		if (buf.length !== 32) {
			throw new Error("KEYS_ENCRYPTION_KEY must decode to 32 bytes (try `openssl rand -base64 32`).");
		}
		cachedKey = buf;
		return buf;
	}
	if (config.NODE_ENV === "production") {
		throw new Error("KEYS_ENCRYPTION_KEY required in production for API key plaintext storage.");
	}
	cachedKey = deriveDevFallback();
	return cachedKey;
}

/** True iff plaintext storage is wired (always true in dev via fallback). */
export function isKeyRevealConfigured(): boolean {
	if (config.KEYS_ENCRYPTION_KEY) return true;
	return config.NODE_ENV !== "production";
}

export function encryptKeyPlaintext(plain: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALG, getKeysEncryptionKey(), iv);
	const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

export function decryptKeyPlaintext(encoded: string): string {
	const [ivB64, payloadB64] = encoded.split(":");
	if (!ivB64 || !payloadB64) throw new Error("Malformed encrypted key");
	const iv = Buffer.from(ivB64, "base64");
	const payload = Buffer.from(payloadB64, "base64");
	if (payload.length < TAG_BYTES) throw new Error("Malformed encrypted key");
	const ct = payload.subarray(0, payload.length - TAG_BYTES);
	const tag = payload.subarray(payload.length - TAG_BYTES);
	const decipher = createDecipheriv(ALG, getKeysEncryptionKey(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
