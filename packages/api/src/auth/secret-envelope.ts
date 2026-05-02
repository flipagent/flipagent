/**
 * AES-256-GCM envelope encryption for token-shaped secrets at rest.
 *
 * Generalises the api-key cipher pattern to anything we store on behalf
 * of a user that we must later present back to upstream services
 * verbatim (eBay refresh tokens, GitHub/Google OAuth tokens, webhook
 * HMAC secrets). The shared module gives us:
 *
 *   - One env var (`SECRETS_ENCRYPTION_KEY`) — separate from
 *     `KEYS_ENCRYPTION_KEY` so the api-key blast radius stays smaller.
 *     Both fall through to a deterministic dev fallback so local setups
 *     don't need ceremony; production raises if the var is missing.
 *
 *   - A version-tagged on-disk format: `enc:v1:&lt;iv-b64&gt;:&lt;ct+tag-b64&gt;`.
 *     The `enc:v1:` prefix lets columns hold a mixed population of
 *     plaintext (legacy rows) and ciphertext (new writes), which is the
 *     migration-friendly shape: the helpers `encryptOptional` and
 *     `decryptIfEncrypted` do the right thing for both, so a backfill
 *     pass can convert at leisure without an outage.
 *
 *   - Symmetric API: `encrypt(s) → string`, `decrypt(s) → string`. The
 *     `Optional` variants tolerate null/undefined inputs because most
 *     of our token columns are nullable.
 *
 * Threat model: same as the api-key cipher. An attacker with both DB
 * and env access can decrypt; a DB-only leak (without env) cannot.
 * GCM authentication tags catch tampering; rotation requires a new key
 * + re-encrypt pass.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALG = "aes-256-gcm";
const TAG_BYTES = 16;
const IV_BYTES = 12;
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function deriveDevFallback(): Buffer {
	const seed = config.BETTER_AUTH_SECRET ?? "flipagent-dev-fallback";
	return createHash("sha256").update(`secrets-envelope:${seed}`).digest();
}

/**
 * 32-byte AES key for the secrets envelope. Production requires
 * `SECRETS_ENCRYPTION_KEY` (base64, decodes to 32 bytes). Dev/test
 * derives a deterministic fallback from `BETTER_AUTH_SECRET` so local
 * boots don't need ceremony — those keys are not portable across
 * environments, which is the point.
 */
export function getSecretsEncryptionKey(): Buffer {
	if (cachedKey) return cachedKey;
	const env = config.SECRETS_ENCRYPTION_KEY;
	if (env) {
		const buf = Buffer.from(env, "base64");
		if (buf.length !== 32) {
			throw new Error("SECRETS_ENCRYPTION_KEY must decode to 32 bytes (try `openssl rand -base64 32`).");
		}
		cachedKey = buf;
		return buf;
	}
	if (config.NODE_ENV === "production") {
		throw new Error(
			"SECRETS_ENCRYPTION_KEY required in production for OAuth token + webhook secret storage at rest.",
		);
	}
	cachedKey = deriveDevFallback();
	return cachedKey;
}

/** True iff a secret string is in the envelope format. */
export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

/** Wrap a plaintext secret in the envelope. Always returns the prefixed form. */
export function encryptSecret(plain: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALG, getSecretsEncryptionKey(), iv);
	const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString("base64")}:${Buffer.concat([ct, tag]).toString("base64")}`;
}

/** Unwrap a previously-enveloped secret. Throws on malformed or wrong-key input. */
export function decryptSecret(encoded: string): string {
	if (!encoded.startsWith(PREFIX)) {
		throw new Error("Not an enveloped secret — missing 'enc:v1:' prefix.");
	}
	const rest = encoded.slice(PREFIX.length);
	const sep = rest.indexOf(":");
	if (sep < 0) throw new Error("Malformed enveloped secret — missing iv/ct separator.");
	const iv = Buffer.from(rest.slice(0, sep), "base64");
	const payload = Buffer.from(rest.slice(sep + 1), "base64");
	if (payload.length < TAG_BYTES) throw new Error("Malformed enveloped secret — payload too short.");
	const ct = payload.subarray(0, payload.length - TAG_BYTES);
	const tag = payload.subarray(payload.length - TAG_BYTES);
	const decipher = createDecipheriv(ALG, getSecretsEncryptionKey(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Boundary helper for read paths that may see legacy plaintext rows
 * alongside enveloped rows during the migration window. Returns the
 * plaintext either way.
 */
export function decryptIfEncrypted(value: string | null | undefined): string | null {
	if (!value) return null;
	if (isEncrypted(value)) return decryptSecret(value);
	return value;
}

/**
 * Boundary helper for write paths. Always envelopes a non-null input;
 * returns null pass-through.
 */
export function encryptOptional(value: string | null | undefined): string | null {
	if (!value) return null;
	if (isEncrypted(value)) return value;
	return encryptSecret(value);
}
