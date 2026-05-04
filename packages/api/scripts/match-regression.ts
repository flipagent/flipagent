/**
 * Regression test for the matcher: runs every labeled dataset registered in
 * scripts/.bench-out/datasets.json, computes F1 against gold labels, asserts
 * each dataset's F1 ≥ floor.
 *
 * Use this after any prompt change, model swap, or pipeline edit:
 *   node --env-file=.env --import tsx scripts/match-regression.ts
 *
 * Optional:
 *   REPS=3                  reps per dataset (default 1)
 *   STRICT_FLOOR=0.75       fail if any dataset's mean F1 falls below this
 *   ENSEMBLE_N=2            run as ensemble (union of N independent runs)
 *   FILTER=casio,jordan     comma-separated dataset id substrings to include
 *   AUDITED_ONLY=1          score only items with audited=true (highest-trust subset)
 */

import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys, type ApiKey } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";

const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";
const REPS = Number.parseInt(process.env.REPS ?? "1", 10);
const FLOOR = Number.parseFloat(process.env.STRICT_FLOOR ?? "0.75");
const ENSEMBLE_N = Number.parseInt(process.env.ENSEMBLE_N ?? "1", 10);
const FILTER = process.env.FILTER ? process.env.FILTER.split(",") : null;
const AUDITED_ONLY = process.env.AUDITED_ONLY === "1";

interface RegistryEntry { id: string; category: string; snapshot: string; labels: string; seed: string; challenges?: string; }
interface Registry { datasets: RegistryEntry[]; }
interface LabelsV2 {
	_meta: { datasetId: string; version: number; counts: Record<string, number> };
	items: Record<string, { label: "match" | "reject"; note: string; confidence: string; audited: boolean; auditNote: string | null }>;
}
interface Snap { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[]; }

const registry = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Registry;
let DATASETS = registry.datasets;
if (FILTER) DATASETS = DATASETS.filter((d) => FILTER.some((f) => d.id.includes(f)));

async function loadApiKey(): Promise<ApiKey | undefined> {
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
	return rows[0];
}

async function flushDecisionCache(seed: string): Promise<void> {
	await db.execute(sql`delete from match_decisions where candidate_id = ${seed}`).catch(() => undefined);
}

interface Result { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; wallMs: number; matchCount: number; }

function score(decided: Map<string, "match" | "reject">, expected: Map<string, "match" | "reject">): Omit<Result, "wallMs" | "matchCount"> {
	let tp = 0, fp = 0, fn = 0, tn = 0;
	for (const [id, gold] of expected) {
		const pred = decided.get(id);
		if (!pred) continue;
		if (pred === "match" && gold === "match") tp++;
		else if (pred === "match" && gold === "reject") fp++;
		else if (pred === "reject" && gold === "match") fn++;
		else tn++;
	}
	const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
	const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
	const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
	return { tp, fp, fn, tn, precision, recall, f1 };
}

async function runOne(snap: Snap, fetchDetail: ReturnType<typeof detailFetcherFor>): Promise<{ matched: Set<string>; allItems: Map<string, ItemSummary>; wallMs: number }> {
	const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
	const dedupedPool: ItemSummary[] = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];

	const t0 = performance.now();
	if (ENSEMBLE_N > 1) {
		const runs = await Promise.all(
			Array.from({ length: ENSEMBLE_N }, () => matchPoolWithLlm(snap.seed, dedupedPool, { useImages: false }, fetchDetail)),
		);
		const matched = new Set<string>();
		const allItems = new Map<string, ItemSummary>();
		for (const r of runs) {
			for (const m of r.match) { matched.add(m.item.itemId); allItems.set(m.item.itemId, m.item); }
			for (const m of r.reject) allItems.set(m.item.itemId, m.item);
		}
		return { matched, allItems, wallMs: Math.round(performance.now() - t0) };
	}
	const r = await matchPoolWithLlm(snap.seed, dedupedPool, { useImages: false }, fetchDetail);
	const matched = new Set<string>();
	const allItems = new Map<string, ItemSummary>();
	for (const m of r.match) { matched.add(m.item.itemId); allItems.set(m.item.itemId, m.item); }
	for (const m of r.reject) allItems.set(m.item.itemId, m.item);
	return { matched, allItems, wallMs: Math.round(performance.now() - t0) };
}

async function main(): Promise<void> {
	const apiKey = await loadApiKey();
	const fetchDetail = detailFetcherFor(apiKey);
	console.log(`[regression] datasets=${DATASETS.map((d) => d.id).join(",")} reps=${REPS} ensemble=${ENSEMBLE_N} floor=${FLOOR} audited_only=${AUDITED_ONLY}`);
	console.log(`[regression] provider=${process.env.LLM_PROVIDER ?? "auto"} model=${process.env.GOOGLE_MODEL ?? process.env.OPENAI_MODEL ?? "default"}`);
	console.log("");

	let allPass = true;
	const datasetMeans: { name: string; f1: number; precision: number; recall: number }[] = [];

	for (const cfg of DATASETS) {
		const snap = JSON.parse(readFileSync(cfg.snapshot, "utf8")) as Snap;
		const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;

		const expected = new Map<string, "match" | "reject">();
		for (const [id, lbl] of Object.entries(labels.items)) {
			if (AUDITED_ONLY && !lbl.audited) continue;
			expected.set(id, lbl.label);
		}

		const reps: Result[] = [];
		for (let r = 0; r < REPS; r++) {
			await flushDecisionCache(cfg.seed);
			const { matched, allItems, wallMs } = await runOne(snap, fetchDetail);
			const decided = new Map<string, "match" | "reject">();
			for (const id of allItems.keys()) decided.set(id, matched.has(id) ? "match" : "reject");
			const s = score(decided, expected);
			reps.push({ ...s, wallMs, matchCount: matched.size });
			console.log(`  ${cfg.id.padEnd(28)} rep${r+1}: F1=${s.f1.toFixed(3)} P=${s.precision.toFixed(3)} R=${s.recall.toFixed(3)} TP=${s.tp} FP=${s.fp} FN=${s.fn} wall=${wallMs}ms`);
		}
		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		const f1Mean = mean(reps.map((r) => r.f1));
		const pMean = mean(reps.map((r) => r.precision));
		const rMean = mean(reps.map((r) => r.recall));
		const wallMean = Math.round(mean(reps.map((r) => r.wallMs)));
		const pass = f1Mean >= FLOOR;
		if (!pass) allPass = false;
		console.log(`  ${cfg.id.padEnd(28)} MEAN: F1=${f1Mean.toFixed(3)} P=${pMean.toFixed(3)} R=${rMean.toFixed(3)} wall=${wallMean}ms  ${pass ? "✓" : "✗ FAIL (floor=" + FLOOR + ")"}`);
		console.log("");
		datasetMeans.push({ name: cfg.id, f1: f1Mean, precision: pMean, recall: rMean });
	}

	const overall = datasetMeans.reduce((a, b) => a + b.f1, 0) / datasetMeans.length;
	console.log(`OVERALL F1 mean across ${datasetMeans.length} datasets: ${overall.toFixed(3)}  ${allPass ? "✓ PASS" : "✗ REGRESSION"}`);
	process.exit(allPass ? 0 : 1);
}

main().catch((err) => { console.error("[regression] fatal:", err); process.exit(2); });
