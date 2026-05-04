/**
 * Aggregate match-*.json files into a (model × chunk × strategy × dataset) F1 table.
 *
 * Detects dataset via snapshot file name baked into match output's `snapPath`.
 *
 *   node --import tsx scripts/matrix-aggregate.ts
 */

import { readdirSync, readFileSync } from "node:fs";

interface Snap {
	soldRaw: { itemId: string }[];
	activeRaw: { itemId: string }[];
}
interface Labels {
	labels: { sold: Record<string, { label: string }>; active: Record<string, { label: string }> };
}
interface MatchOut {
	snapPath?: string;
	provider: string;
	model: string;
	verifyChunk?: number;
	strategy?: string;
	totalMs: number;
	match: { itemId: string; title?: string }[];
	reject: { itemId: string; title?: string }[];
}

const CONFIGS = [
	{ name: "casio", snap: "scripts/.bench-out/snap-2026-05-03T03-51-58-084Z.json", labels: "scripts/.bench-out/labels-casio-ga2100-v3-manual.json" },
	{ name: "jordan", snap: readFileSync("/tmp/snap-path.txt", "utf8").trim(), labels: "scripts/.bench-out/labels-jordan4-blackcat-sz12.json" },
];

interface DatasetCtx {
	expected: Map<string, "match" | "reject">;
}
const ctx = new Map<string, DatasetCtx>();
for (const cfg of CONFIGS) {
	const snap = JSON.parse(readFileSync(cfg.snap, "utf8")) as Snap;
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as Labels;
	const expected = new Map<string, "match" | "reject">();
	const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
	for (let i = 0; i < snap.soldRaw.length; i++) {
		const lab = labels.labels.sold[String(i)];
		if (lab) expected.set(snap.soldRaw[i]!.itemId, lab.label as "match" | "reject");
	}
	for (let i = 0; i < snap.activeRaw.length; i++) {
		const it = snap.activeRaw[i]!;
		if (soldIds.has(it.itemId)) continue;
		const lab = labels.labels.active[String(i)];
		if (lab) expected.set(it.itemId, lab.label as "match" | "reject");
	}
	ctx.set(cfg.name, { expected });
}

function detectDataset(out: MatchOut): string | null {
	if (out.snapPath?.includes("03-51-58")) return "casio";
	const sample = out.match[0]?.itemId ?? out.reject[0]?.itemId;
	if (!sample) return null;
	for (const [name, c] of ctx) if (c.expected.has(sample)) return name;
	return null;
}

interface Row {
	dataset: string;
	model: string;
	chunk: number | null;
	strategy: string;
	wallMs: number;
	tp: number; fp: number; fn: number; tn: number;
	precision: number; recall: number; f1: number;
}

const rows: Row[] = [];
const files = readdirSync("scripts/.bench-out").filter((f) => f.startsWith("match-") && f.endsWith(".json"));

for (const f of files) {
	const out = JSON.parse(readFileSync(`scripts/.bench-out/${f}`, "utf8")) as MatchOut;
	const ds = detectDataset(out);
	if (!ds) continue;
	const expected = ctx.get(ds)!.expected;

	const decided = new Map<string, "match" | "reject">();
	for (const m of out.match) decided.set(m.itemId, "match");
	for (const m of out.reject) decided.set(m.itemId, "reject");

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

	rows.push({
		dataset: ds,
		model: out.model,
		chunk: out.verifyChunk ?? null,
		strategy: out.strategy ?? (out.provider.startsWith("ensemble") ? "ensemble2" : "single"),
		wallMs: out.totalMs,
		tp, fp, fn, tn, precision, recall, f1,
	});
}

// Aggregate by (dataset, model, chunk, strategy)
interface Agg {
	count: number;
	wallSum: number;
	f1Sum: number;
	f1Min: number;
	f1Max: number;
	precSum: number;
	recSum: number;
}
const agg = new Map<string, Agg>();
for (const r of rows) {
	const key = `${r.dataset}|${r.model}|c${r.chunk ?? "?"}|${r.strategy}`;
	let a = agg.get(key);
	if (!a) {
		a = { count: 0, wallSum: 0, f1Sum: 0, f1Min: 1, f1Max: 0, precSum: 0, recSum: 0 };
		agg.set(key, a);
	}
	a.count++;
	a.wallSum += r.wallMs;
	a.f1Sum += r.f1;
	a.f1Min = Math.min(a.f1Min, r.f1);
	a.f1Max = Math.max(a.f1Max, r.f1);
	a.precSum += r.precision;
	a.recSum += r.recall;
}

console.log("");
console.log("dataset | model                          | chunk | strategy   | n | F1mean F1min F1max | Pmean Rmean | wall_ms");
console.log("--------+--------------------------------+-------+------------+---+---------------------+-------------+--------");
const sortedKeys = [...agg.keys()].sort();
for (const key of sortedKeys) {
	const [dataset, model, chunk, strategy] = key.split("|");
	const a = agg.get(key)!;
	console.log(
		`${dataset!.padEnd(8)}| ${model!.padEnd(31)}| ${chunk!.padEnd(6)}| ${strategy!.padEnd(11)}| ${String(a.count).padStart(2)}| ${(a.f1Sum/a.count).toFixed(3)}  ${a.f1Min.toFixed(3)} ${a.f1Max.toFixed(3)} | ${(a.precSum/a.count).toFixed(3)} ${(a.recSum/a.count).toFixed(3)} | ${Math.round(a.wallSum/a.count).toString().padStart(6)}`,
	);
}

console.log("");
console.log("=== TOP 5 by F1 mean (across all configs) ===");
const ranked = [...agg.entries()].map(([k, a]) => ({ k, mean: a.f1Sum/a.count, count: a.count }));
ranked.sort((a, b) => b.mean - a.mean);
for (const r of ranked.slice(0, 10)) console.log(`  ${r.mean.toFixed(3)}  (${r.count} runs)  ${r.k}`);
