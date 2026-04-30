/**
 * Walks the deterministic cluster pipeline (epid → gtin → singletons)
 * for an active search query. Prints what each stage assigns, what
 * falls through, and the final clusters. Diagnostic only — not used by
 * routes.
 */

import { searchActiveListings } from "../src/services/listings/search.js";
import { clusterByProduct } from "../src/services/match/cluster.js";

const q = process.argv[2] ?? "gucci watch";
const limit = Number.parseInt(process.argv[3] ?? "50", 10);

const items = (await searchActiveListings({ q, limit }, {})).body.itemSummaries ?? [];
console.log(`fetched ${items.length} active listings for q="${q}"\n`);

let withEpid = 0;
let withGtin = 0;
let bare = 0;
for (const i of items) {
	if (i.epid) withEpid++;
	else if (i.gtin) withGtin++;
	else bare++;
}
console.log(`stage breakdown:`);
console.log(`  epid present:        ${withEpid}`);
console.log(`  gtin present:        ${withGtin}`);
console.log(`  neither (singleton): ${bare}`);
console.log();

const start = performance.now();
const clusters = await clusterByProduct(items);
const ms = Math.round(performance.now() - start);
console.log(`clusterByProduct → ${clusters.length} clusters in ${ms}ms\n`);

const bySource = new Map<string, number>();
for (const c of clusters) bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
console.log(`by source:`);
for (const [src, n] of bySource) console.log(`  ${src.padEnd(10)} ${n} clusters`);
console.log();

console.log(`clusters (sorted by item count desc):`);
const sorted = [...clusters].sort((a, b) => b.items.length - a.items.length);
for (const c of sorted) {
	const head = `[${c.source}] n=${c.items.length}`;
	console.log(`  ${head.padEnd(20)} ${c.canonical}`);
	for (const it of c.items) {
		console.log(`      └ ${(it.itemId ?? "?").padEnd(22)} $${it.price?.value ?? "?"}  ${(it.condition ?? "-").padEnd(15)} ${it.title.slice(0, 70)}`);
	}
}
