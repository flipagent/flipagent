/**
 * Inspects which signals are actually populated in active-search
 * ItemSummary responses for a given query. Diagnostic only — answers
 * "what grouping signals do we already have at this point, before
 * any detail fetch?"
 */

import { searchActiveListings } from "../src/services/items/search.js";

const q = process.argv[2] ?? "gucci watch";
const limit = Number.parseInt(process.argv[3] ?? "50", 10);
const items = (await searchActiveListings({ q, limit }, {})).body.itemSummaries ?? [];

const fields = ["epid", "gtin", "itemGroupHref", "leafCategoryIds", "categoryId", "condition", "seller"] as const;
const counts: Record<string, number> = {};
for (const f of fields) counts[f] = 0;

for (const i of items) {
	for (const f of fields) {
		const v = (i as Record<string, unknown>)[f];
		const has = Array.isArray(v) ? v.length > 0 : v != null && v !== "";
		if (has) counts[f]!++;
	}
}

console.log(`q="${q}"  n=${items.length}\n`);
console.log(`field            populated    %`);
for (const f of fields) {
	const c = counts[f] ?? 0;
	console.log(`  ${f.padEnd(15)} ${String(c).padStart(3)}/${items.length}      ${String(Math.round((c / items.length) * 100)).padStart(3)}%`);
}

// Title SKU-token extraction — generic heuristic: tokens of mixed letters
// + digits, length 4-12, not all letters or all digits.
console.log(`\ntitle SKU-token candidates (regex /[A-Z]+\\d+|[\\d]+[A-Z]+\\b/i):`);
const tokenCounts = new Map<string, number>();
for (const i of items) {
	const tokens = i.title.match(/\b(?:[A-Z]+\d+[A-Z]?\d*|\d{3,4}[A-Z]+)\b/gi) ?? [];
	const norm = new Set(tokens.map((t) => t.toUpperCase()));
	for (const t of norm) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
}
const ranked = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  ${ranked.length} unique tokens, top 10 by frequency:`);
for (const [tok, n] of ranked.slice(0, 10)) {
	console.log(`    ${n}× ${tok}`);
}
