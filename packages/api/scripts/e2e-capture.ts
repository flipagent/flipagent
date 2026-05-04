/**
 * End-to-end smoke for the passive-capture pipeline. Simulates exactly
 * what the Chrome extension does:
 *
 *   1. Issue a bridge token for the dev api key (`POST /v1/bridge/tokens`).
 *   2. Scrape a real eBay PDP via Oxylabs and parse it through the
 *      shared `parseEbayDetailHtml` (same path content.ts uses).
 *   3. POST the parsed payload to `/v1/bridge/capture` with the bridge
 *      token.
 *   4. Verify a row landed in `bridge_captures`.
 *   5. Verify the response cache (`proxy_response_cache`) now has a
 *      `source: "capture"` entry for the same itemId.
 *   6. Call `getItemDetail()` for that itemId — must return the cached
 *      copy (CacheHit `source: "capture"`), without issuing a fresh
 *      Oxylabs scrape.
 *
 * Pass = capture pipeline functional end-to-end.
 *
 * Usage (server must be running on :4000):
 *   ITEM_ID=v1|187760409559|0 \
 *     node --env-file=.env --import tsx scripts/e2e-capture.ts
 */
import { eq, sql } from "drizzle-orm";
import { JSDOM } from "jsdom";
import { parseEbayDetailHtml } from "@flipagent/ebay-scraper";
import { issueBridgeToken } from "../src/auth/bridge-tokens.js";
import { db } from "../src/db/client.js";
import { apiKeys, bridgeCaptures, proxyResponseCache } from "../src/db/schema.js";
import { fetchHtmlViaScraperApi } from "../src/services/ebay/scrape/scraper-api/index.js";
import { getItemDetail } from "../src/services/items/detail.js";

const ITEM_ID = process.env.ITEM_ID ?? "v1|187760409559|0";
const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";

const m = /^v1\|(\d+)\|/.exec(ITEM_ID);
if (!m?.[1]) throw new Error(`bad ITEM_ID ${ITEM_ID}`);
const legacyId = m[1];

function ok(label: string, cond: unknown, detail?: string): boolean {
	const sym = cond ? "✓" : "✗";
	console.log(`  ${sym} ${label}${detail ? ` — ${detail}` : ""}`);
	return Boolean(cond);
}

async function main(): Promise<void> {
	const start = Date.now();
	console.log(`\n[e2e] capture flow for ${ITEM_ID} (legacy=${legacyId})`);

	// Pre-clear any existing cache for this itemId so the test is hermetic
	await db.delete(proxyResponseCache).where(eq(proxyResponseCache.path, "/buy/browse/v1/item")).execute();
	await db.delete(bridgeCaptures).where(eq(bridgeCaptures.apiKeyId, APIKEY_ID)).execute();

	// 1. Issue bridge token
	console.log(`\n1. Issue bridge token`);
	const apiKey = (await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID)))[0];
	if (!apiKey) throw new Error(`apiKey ${APIKEY_ID} not found`);
	const token = await issueBridgeToken({ apiKeyId: apiKey.id, userId: apiKey.userId, deviceName: "e2e-test" });
	ok("bridge token issued", token.plaintext.startsWith("fbt_"), `prefix=${token.prefix}`);

	// 2. Scrape PDP and parse
	console.log(`\n2. Scrape + parse PDP`);
	const url = `https://www.ebay.com/itm/${legacyId}`;
	const html = await fetchHtmlViaScraperApi(url);
	const domFactory = (h: string) => new JSDOM(h).window.document;
	const rawDetail = parseEbayDetailHtml(html, url, domFactory);
	ok("parser returned object", rawDetail.itemId === legacyId, `title="${rawDetail.title.slice(0, 60)}"`);
	ok("epid extracted", !!rawDetail.epid, `epid=${rawDetail.epid ?? "(none)"}`);

	// 3. POST to /v1/bridge/capture
	console.log(`\n3. POST /v1/bridge/capture`);
	const res = await fetch(`${API_BASE}/v1/bridge/capture`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.plaintext}` },
		body: JSON.stringify({ url, rawDetail }),
	});
	ok("HTTP 200", res.ok, `status=${res.status}`);
	const body = (await res.json()) as { stored?: boolean; itemId?: string; reason?: string };
	ok("stored=true", body.stored === true, `body=${JSON.stringify(body)}`);

	// 4. Verify bridge_captures row
	console.log(`\n4. Verify DB rows`);
	const captureRows = await db.select().from(bridgeCaptures).where(eq(bridgeCaptures.apiKeyId, APIKEY_ID));
	ok("bridge_captures row exists", captureRows.length === 1, `${captureRows.length} row(s)`);
	if (captureRows[0]) {
		ok("itemId matches", captureRows[0].itemId === legacyId, `${captureRows[0].itemId}`);
		ok("url stored", captureRows[0].url === url, captureRows[0].url);
	}

	// 5. Verify proxy_response_cache row with source="capture"
	const cacheRows = await db.execute(sql`
		select source, body->>'source' as inner_source, expires_at > now() as fresh
		from proxy_response_cache where path = '/buy/browse/v1/item'
	`);
	const row = (cacheRows as { source: string; inner_source: string; fresh: boolean }[])[0];
	ok("proxy_response_cache has 1 entry", cacheRows.length === 1);
	if (row) {
		ok("source=capture", row.source === "capture", `source=${row.source}`);
		ok("not yet expired", row.fresh === true);
	}

	// 6. getItemDetail should now hit cache
	console.log(`\n6. getItemDetail() — must hit cache, not Oxylabs`);
	const detailStart = Date.now();
	const detail = await getItemDetail(legacyId);
	const detailMs = Date.now() - detailStart;
	ok("returned ItemDetail", !!detail, `wall=${detailMs}ms`);
	// `capture` is internal — externally coerced to `scrape` (same shape data,
	// just sourced from the bridge endpoint instead of a fresh Oxylabs call).
	// Real provenance lives in `bridge_captures`. Cache hit confirmed by speed.
	ok("source=scrape (capture coerced)", detail?.source === "scrape", `source=${detail?.source}`);
	if (detail) {
		ok("itemId matches", detail.body.legacyItemId === legacyId);
		ok("title matches", detail.body.title === rawDetail.title);
		ok("epid matches", detail.body.epid === rawDetail.epid);
		ok("fast (<100ms = no scrape)", detailMs < 100, `${detailMs}ms`);
	}

	const total = Date.now() - start;
	console.log(`\n[e2e] done in ${total}ms\n`);
	process.exit(0);
}
main().catch((err) => { console.error("FAIL:", err); process.exit(2); });
