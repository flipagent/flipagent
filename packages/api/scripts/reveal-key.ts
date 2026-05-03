import { eq } from "drizzle-orm";
import { decryptKeyPlaintext } from "../src/auth/key-cipher.js";
import { db } from "../src/db/client.js";
import { apiKeys, userEbayOauth } from "../src/db/schema.js";

const apiKeyId = process.argv[2];
if (!apiKeyId) {
	console.error("usage: reveal-key.ts <apiKeyId>");
	process.exit(1);
}

const [row] = await db
	.select({ ct: apiKeys.keyCiphertext })
	.from(apiKeys)
	.where(eq(apiKeys.id, apiKeyId))
	.limit(1);

if (!row?.ct) {
	console.error("no ciphertext for that key (legacy or env-key missing)");
	process.exit(1);
}

process.stdout.write(decryptKeyPlaintext(row.ct));
process.exit(0);
