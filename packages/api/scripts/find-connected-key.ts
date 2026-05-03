import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys, userEbayOauth } from "../src/db/schema.js";

const rows = await db
	.select({
		id: apiKeys.id,
		prefix: apiKeys.prefix,
		tier: apiKeys.tier,
		ownerEmail: apiKeys.ownerEmail,
		ebayUserName: userEbayOauth.ebayUserName,
	})
	.from(apiKeys)
	.innerJoin(userEbayOauth, eq(userEbayOauth.apiKeyId, apiKeys.id))
	.limit(10);

console.log(JSON.stringify(rows, null, 2));
process.exit(0);
