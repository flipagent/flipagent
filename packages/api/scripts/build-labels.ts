/**
 * Build a v2 label file from a snapshot + a "spec" object that maps pool
 * positions to labels. Spec format:
 *   { sold: { "0": "match", "1": "reject", ...}, active: { ... } }
 * (or shorthand "ranges" — see DATASETS below)
 *
 * Run:
 *   DATASET_NAME=pokemon-charizard-228-psa10 \
 *   SNAPSHOT=scripts/.bench-out/snap-XXX.json \
 *   SPEC=scripts/.bench-out/labelspec-pokemon-charizard-228-psa10.json \
 *   node --import tsx scripts/build-labels.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

interface Snap { seed: { itemId: string; title: string; conditionId?: string }; soldRaw: { itemId: string; title: string }[]; activeRaw: { itemId: string; title: string }[]; }
interface Spec {
	rule: string;
	challenges?: string;
	defaults?: { sold?: "match" | "reject"; active?: "match" | "reject" };
	overrides: { sold?: Record<string, "match" | "reject">; active?: Record<string, "match" | "reject"> };
	notes?: { sold?: Record<string, string>; active?: Record<string, string> };
}

const NAME = process.env.DATASET_NAME!;
const SNAP_PATH = process.env.SNAPSHOT!;
const SPEC_PATH = process.env.SPEC!;
if (!NAME || !SNAP_PATH || !SPEC_PATH) throw new Error("DATASET_NAME, SNAPSHOT, SPEC env required");

const snap = JSON.parse(readFileSync(SNAP_PATH, "utf8")) as Snap;
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as Spec;

const items: Record<string, { label: string; note: string; confidence: string; audited: boolean; auditNote: string | null }> = {};
const seen = new Set<string>();

function label(arr: { itemId: string; title: string }[], side: "sold" | "active"): void {
	for (let i = 0; i < arr.length; i++) {
		const it = arr[i]!;
		if (seen.has(it.itemId)) continue;
		seen.add(it.itemId);
		const ovr = spec.overrides[side]?.[String(i)];
		const dflt = spec.defaults?.[side] ?? "reject";
		const lbl = ovr ?? dflt;
		const note = spec.notes?.[side]?.[String(i)] ?? `${side}[${i}] ${it.title.slice(0, 80)}`;
		items[it.itemId] = { label: lbl, note, confidence: "high", audited: false, auditNote: null };
	}
}
label(snap.soldRaw, "sold");
label(snap.activeRaw, "active");

const counts = {
	total: Object.keys(items).length,
	match: Object.values(items).filter((i) => i.label === "match").length,
	reject: Object.values(items).filter((i) => i.label === "reject").length,
	audited: 0,
	borderline: 0,
};

const out = {
	_meta: {
		datasetId: NAME,
		version: 2,
		snapshot: SNAP_PATH,
		seed: { itemId: snap.seed.itemId, title: snap.seed.title },
		rule: spec.rule,
		challenges: spec.challenges ?? "",
		auditHistory: [{ date: new Date().toISOString().slice(0, 10), action: "initial labels via build-labels.ts", auditor: "claude" }],
		counts,
	},
	items,
};

const outPath = `scripts/.bench-out/labels-${NAME}.v2.json`;
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Built ${counts.total} labels (${counts.match} match / ${counts.reject} reject) → ${outPath}`);
