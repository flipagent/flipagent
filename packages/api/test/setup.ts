/**
 * Test runtime setup: load .env if present, then sanity-check the
 * required vars so a misconfigured shell fails fast with a useful error.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });
else loadEnv();

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL not set. Run docker compose up -d postgres + npm run db:migrate first.");
}

// Force /buy/* tests onto the scrape path so the existing vi.mock on
// proxy/scrape.js is what they actually exercise. With EBAY_CLIENT_ID set
// (real local dev config), routes/ebay/{search,item-detail}.ts return early
// via ebayPassthroughApp and bypass scrape entirely — useful in dev, fatal
// in CI where the mocked itemIds don't exist on api.ebay.com.
//
// Assign empty strings (not delete) — dotenv re-runs in src/config.ts and
// only fills *unset* keys. Leaving "" present prevents the .env value from
// re-populating, and the empty string flips isEbayOAuthConfigured() to false.
process.env.EBAY_CLIENT_ID = "";
process.env.EBAY_CLIENT_SECRET = "";
process.env.EBAY_RU_NAME = "";
