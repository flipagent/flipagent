/**
 * Run matcher N times on the same snapshot, then UNION the matches.
 *
 * Theory: gemini's recall is stochastic — same rule, sometimes applied, sometimes
 * not. P(match item correctly) per run ≈ 0.85 → 2-run union recall ≈ 1 - 0.15² = 0.978.
 * Trades latency (2x) for recall.
 *
 *   ENSEMBLE_N=2 SNAPSHOT=... node --env-file=.env --import tsx scripts/match-bench-ensemble.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys, type ApiKey } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";

const SNAP = process.env.SNAPSHOT!;
const APIKEY_ID = process.env.APIKEY_ID;
const N = Number.parseInt(process.env.ENSEMBLE_N ?? "2", 10);

const snap = JSON.parse(readFileSync(SNAP, "utf8")) as { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[] };
const apiKey: ApiKey | undefined = APIKEY_ID
	? (await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID)))[0]
	: undefined;

const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
const dedupedPool: ItemSummary[] = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];
const useImages = process.env.USE_IMAGES !== "false";

console.log(`[ensemble N=${N}] pool=${dedupedPool.length} useImages=${useImages}`);
const t0 = performance.now();

// Run N matchers in parallel — they share the LLM_MAX_CONCURRENT semaphore so
// total in-flight is still bounded.
const runs = await Promise.all(
	Array.from({ length: N }, async (_, i) => {
		const start = performance.now();
		const r = await matchPoolWithLlm(snap.seed, dedupedPool, { useImages }, detailFetcherFor(apiKey));
		console.log(`[ensemble] run ${i} done in ${Math.round(performance.now() - start)}ms  match=${r.totals.match}`);
		return r;
	}),
);

// UNION: an item is "match" if ANY run said match. Otherwise reject.
const matchSet = new Set<string>();
for (const r of runs) for (const m of r.match) matchSet.add(m.item.itemId);
const allItems = new Map<string, ItemSummary>();
for (const r of runs) {
	for (const m of r.match) allItems.set(m.item.itemId, m.item);
	for (const m of r.reject) allItems.set(m.item.itemId, m.item);
}

const totalMs = Math.round(performance.now() - t0);
const matched = [...matchSet].map((id) => ({ itemId: id, title: allItems.get(id)?.title ?? "?", reason: "ensemble union" }));
const rejected: { itemId: string; title: string; reason: string }[] = [];
for (const [id, item] of allItems) {
	if (!matchSet.has(id)) rejected.push({ itemId: id, title: item.title, reason: "all runs rejected" });
}

console.log(`[ensemble] TOTAL ${totalMs}ms  match=${matched.length} reject=${rejected.length}`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const verifyChunk = process.env.VERIFY_CHUNK ?? "10";
const out = {
	stamp,
	snapPath: SNAP,
	provider: `ensemble-${N}`,
	model: process.env.GOOGLE_MODEL ?? process.env.OPENAI_MODEL ?? "?",
	verifyChunk: Number.parseInt(verifyChunk, 10),
	strategy: `ensemble${N}`,
	useImages,
	totalMs,
	match: matched,
	reject: rejected,
};
const path = `scripts/.bench-out/match-${out.model}-c${verifyChunk}-ensemble${N}-${stamp}.json`;
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`[ensemble] → ${path}`);
process.exit(0);
