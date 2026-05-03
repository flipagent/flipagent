/**
 * One-off: issue a brand-new flipagent API key + transfer the existing
 * eBay OAuth binding from a legacy key (no ciphertext) onto it. The new
 * plaintext is printed to stdout — copy it for FLIPAGENT_API_KEY.
 *
 * The legacy key stays alive (we just point its OAuth row at the new
 * one). After verifying the new key works, you can revoke the legacy
 * row via /v1/keys/revoke.
 */

import { eq } from "drizzle-orm";
import { issueKey } from "../src/auth/keys.js";
import { db } from "../src/db/client.js";
import { userEbayOauth } from "../src/db/schema.js";

const legacyApiKeyId = process.argv[2];
if (!legacyApiKeyId) {
	console.error("usage: rotate-connected-key.ts <legacyApiKeyId>");
	process.exit(1);
}

const issued = await issueKey({ tier: "growth", ownerEmail: `verify-rotated-${Date.now()}@flipagent.dev` });
await db.update(userEbayOauth).set({ apiKeyId: issued.id }).where(eq(userEbayOauth.apiKeyId, legacyApiKeyId));

process.stdout.write(issued.plaintext);
process.exit(0);
