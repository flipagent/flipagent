/**
 * Score model match decisions against the human-labeled ground truth.
 * Reads a snapshot + label file + multiple match-result files.
 *
 *   LABELS=scripts/.bench-out/labels-casio-ga2100.json \
 *   SNAPSHOT=scripts/.bench-out/snap-XYZ.json \
 *   node --import tsx scripts/match-score.ts \
 *     scripts/.bench-out/match-gemini-2.5-flash-XYZ.json \
 *     scripts/.bench-out/match-gpt-5.4-mini-XYZ.json \
 *     ...
 */

import { readFileSync, readdirSync } from "node:fs";

const LABELS = process.env.LABELS;
const SNAPSHOT = process.env.SNAPSHOT;
if (!LABELS || !SNAPSHOT) {
	console.error("LABELS and SNAPSHOT env vars required");
	process.exit(1);
}

interface Snap {
	soldRaw: { itemId: string; title: string }[];
	activeRaw: { itemId: string; title: string }[];
}
interface Labels {
	labels: {
		sold: Record<string, { label: "match" | "reject"; note: string }>;
		active: Record<string, { label: "match" | "reject"; note: string }>;
	};
}
interface MatchResult {
	model: string;
	totalMs: number;
	match: { itemId: string; title: string; reason: string }[];
	reject: { itemId: string; title: string; reason: string }[];
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snap;
const labels = JSON.parse(readFileSync(LABELS, "utf8")) as Labels;

// Build itemId → expected label map from the snapshot pool order.
const expected = new Map<string, "match" | "reject">();
const itemIdToTitle = new Map<string, string>();
for (let i = 0; i < snap.soldRaw.length; i++) {
	const it = snap.soldRaw[i]!;
	const lab = labels.labels.sold[String(i)];
	if (lab) expected.set(it.itemId, lab.label);
	itemIdToTitle.set(it.itemId, it.title);
}
const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
for (let i = 0; i < snap.activeRaw.length; i++) {
	const it = snap.activeRaw[i]!;
	if (soldIds.has(it.itemId)) continue; // dedup
	const lab = labels.labels.active[String(i)];
	if (lab) expected.set(it.itemId, lab.label);
	itemIdToTitle.set(it.itemId, it.title);
}

const totalLabeled = expected.size;
const totalMatchTrue = [...expected.values()].filter((v) => v === "match").length;
const totalRejectTrue = totalLabeled - totalMatchTrue;
console.log(`labels: pool=${totalLabeled} match=${totalMatchTrue} reject=${totalRejectTrue}`);

const files = process.argv.slice(2);
if (files.length === 0) {
	const candidates = readdirSync("scripts/.bench-out").filter((f) => f.startsWith("match-")).sort();
	files.push(...candidates.map((f) => `scripts/.bench-out/${f}`));
}

const rows: { model: string; ms: number; tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; falsePosItems: string[]; falseNegItems: string[] }[] = [];

for (const file of files) {
	const r = JSON.parse(readFileSync(file, "utf8")) as MatchResult;
	let tp = 0, fp = 0, fn = 0, tn = 0;
	const falsePos: string[] = [];
	const falseNeg: string[] = [];

	const decided = new Map<string, "match" | "reject">();
	for (const m of r.match) decided.set(m.itemId, "match");
	for (const m of r.reject) decided.set(m.itemId, "reject");

	for (const [itemId, gold] of expected) {
		const pred = decided.get(itemId);
		if (!pred) continue; // not decided (e.g. dedup'd or filtered before matcher)
		if (pred === "match" && gold === "match") tp++;
		else if (pred === "match" && gold === "reject") {
			fp++;
			falsePos.push(`${itemId} ${itemIdToTitle.get(itemId)?.slice(0, 70)}`);
		}
		else if (pred === "reject" && gold === "match") {
			fn++;
			falseNeg.push(`${itemId} ${itemIdToTitle.get(itemId)?.slice(0, 70)}`);
		}
		else tn++;
	}
	const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
	const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
	const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
	rows.push({ model: r.model, ms: r.totalMs, tp, fp, fn, tn, precision, recall, f1, falsePosItems: falsePos, falseNegItems: falseNeg });
}

console.log("");
console.log("model                          | wallMs  | TP  FP  FN  TN  | prec   recall  F1");
console.log("-------------------------------+---------+----+----+----+----+--------+--------+------");
for (const r of rows.sort((a, b) => b.f1 - a.f1)) {
	console.log(
		`${r.model.padEnd(30)} | ${String(r.ms).padStart(6)}  | ${String(r.tp).padStart(2)}  ${String(r.fp).padStart(2)}  ${String(r.fn).padStart(2)}  ${String(r.tn).padStart(2)}  | ${r.precision.toFixed(3)}  ${r.recall.toFixed(3)}  ${r.f1.toFixed(3)}`,
	);
}

console.log("\n=== Disagreements (false positives + false negatives) ===");
for (const r of rows) {
	console.log(`\n--- ${r.model} ---`);
	if (r.falsePosItems.length) {
		console.log("  FALSE POSITIVES (model said match, gold says reject):");
		for (const f of r.falsePosItems) console.log(`    + ${f}`);
	}
	if (r.falseNegItems.length) {
		console.log("  FALSE NEGATIVES (model said reject, gold says match):");
		for (const f of r.falseNegItems) console.log(`    - ${f}`);
	}
	if (!r.falsePosItems.length && !r.falseNegItems.length) console.log("  (perfect)");
}
