/**
 * Verify in-flight cache dedup: when N callers race the same uncached
 * resource, only ONE upstream fetch happens; the rest share the result.
 *
 * Strategy: use a counted fetcher that increments a counter every time
 * it runs. Issue 10 concurrent withCache() calls with the same key on
 * an empty cache. Expect counter == 1 (dedup worked) and all 10 callers
 * get the same body.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { proxyResponseCache } from "../src/db/schema.js";
import { hashQuery } from "../src/services/shared/cache.js";
import { withCache } from "../src/services/shared/with-cache.js";

const CONCURRENT = 10;

async function main(): Promise<void> {
	console.log(`[dedup-test] ${CONCURRENT} concurrent withCache calls, same key, empty cache\n`);

	// Clear cache row for this key
	const path = "/test/dedup";
	const queryHash = hashQuery({ test: "inflight-dedup", at: Date.now() });
	await db.delete(proxyResponseCache).where(sql`path = ${path} AND query_hash = ${queryHash}`).execute();

	let fetcherCalls = 0;
	const fetcher = async () => {
		fetcherCalls++;
		// Simulate slow upstream — 500ms
		await new Promise((r) => setTimeout(r, 500));
		return { body: { value: "fetched-once", at: Date.now() }, source: "scrape" as const };
	};

	const t0 = Date.now();
	const results = await Promise.all(
		Array.from({ length: CONCURRENT }, () =>
			withCache({ scope: "test:dedup", path, queryHash, ttlSec: 60 }, fetcher),
		),
	);
	const wall = Date.now() - t0;

	console.log(`  fetcher invocations:     ${fetcherCalls}    (expected 1)`);
	console.log(`  total wall:              ${wall}ms          (expected ~500ms — one fetch)`);
	console.log(`  results all match:       ${new Set(results.map((r) => JSON.stringify(r.body))).size === 1}`);
	console.log(`  any cache hits (false):  ${results.some((r) => r.fromCache)}    (expected false — first call)`);

	// Now run again — cache should be populated, fetcher 0 invocations
	console.log(`\n[dedup-test] same calls again (cache should hit)`);
	fetcherCalls = 0;
	const t1 = Date.now();
	const results2 = await Promise.all(
		Array.from({ length: CONCURRENT }, () =>
			withCache({ scope: "test:dedup", path, queryHash, ttlSec: 60 }, fetcher),
		),
	);
	const wall2 = Date.now() - t1;
	console.log(`  fetcher invocations:     ${fetcherCalls}    (expected 0)`);
	console.log(`  total wall:              ${wall2}ms          (expected <50ms — cache hits)`);
	console.log(`  all from cache:          ${results2.every((r) => r.fromCache)}    (expected true)`);

	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
