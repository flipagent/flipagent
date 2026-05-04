/**
 * Migrate label files from pool-index-keyed (v1) to itemId-keyed (v2).
 *
 * v1 keyed by `sold[i]` / `active[i]` — fragile if snapshot pool changes.
 * v2 keyed by `itemId` — survives re-snapshots and easier to audit.
 *
 * Schema v2:
 *   {
 *     _meta: { datasetId, version: 2, snapshot, seed, rule, auditHistory },
 *     items: {
 *       "<itemId>": { label, note, confidence, audited, auditNote }
 *     }
 *   }
 */

import { readFileSync, writeFileSync } from "node:fs";

interface Snap {
	seed: { itemId: string; title: string };
	soldRaw: { itemId: string }[];
	activeRaw: { itemId: string }[];
}
interface V1 {
	_meta?: Record<string, unknown>;
	labels: {
		sold: Record<string, { label: string; note: string }>;
		active: Record<string, { label: string; note: string }>;
	};
}

const MIGRATIONS = [
	{ v1: "scripts/.bench-out/labels-casio-ga2100-v3-manual.json", snap: "scripts/.bench-out/snap-2026-05-03T05-55-31-234Z.json", out: "scripts/.bench-out/labels-casio-ga2100-1A.v2.json", id: "casio-ga2100-1A" },
	{ v1: "scripts/.bench-out/labels-jordan4-blackcat-sz12.json", snap: "scripts/.bench-out/snap-2026-05-03T05-55-42-455Z.json", out: "scripts/.bench-out/labels-jordan4-blackcat-12.v2.json", id: "jordan4-blackcat-12" },
	{ v1: "scripts/.bench-out/labels-iphone-15-pro-max-256gb.json", snap: "scripts/.bench-out/snap-2026-05-03T06-11-27-978Z.json", out: "scripts/.bench-out/labels-iphone-15-pro-max-256gb-natural.v2.json", id: "iphone15-pm-256gb-natural" },
];

for (const m of MIGRATIONS) {
	const v1 = JSON.parse(readFileSync(m.v1, "utf8")) as V1;
	const snap = JSON.parse(readFileSync(m.snap, "utf8")) as Snap;

	const items: Record<string, { label: string; note: string; confidence: string; audited: boolean; auditNote: string | null }> = {};
	const dups: string[] = [];
	for (let i = 0; i < snap.soldRaw.length; i++) {
		const lab = v1.labels.sold[String(i)];
		if (!lab) continue;
		const id = snap.soldRaw[i]!.itemId;
		if (items[id]) dups.push(`sold[${i}] ${id} already labeled`);
		// Borderline detection: heuristic from note text
		const noteLower = lab.note.toLowerCase();
		const confidence = /borderline|lenient|uncertain|suspicious|ambiguous/.test(noteLower) ? "medium" : "high";
		items[id] = { label: lab.label, note: lab.note, confidence, audited: false, auditNote: null };
	}
	const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
	for (let i = 0; i < snap.activeRaw.length; i++) {
		const id = snap.activeRaw[i]!.itemId;
		if (soldIds.has(id)) continue; // dedup — sold wins
		const lab = v1.labels.active[String(i)];
		if (!lab) continue;
		const noteLower = lab.note.toLowerCase();
		const confidence = /borderline|lenient|uncertain|suspicious|ambiguous/.test(noteLower) ? "medium" : "high";
		items[id] = { label: lab.label, note: lab.note, confidence, audited: false, auditNote: null };
	}

	const v2 = {
		_meta: {
			datasetId: m.id,
			version: 2,
			snapshot: m.snap,
			seed: { itemId: snap.seed.itemId, title: snap.seed.title },
			rule: (v1._meta as { rule?: string })?.rule ?? "(see v1 _meta for original rule)",
			migratedFrom: m.v1,
			auditHistory: [{ date: new Date().toISOString().slice(0, 10), action: "v1 → v2 migration", auditor: "claude" }],
			counts: {
				total: Object.keys(items).length,
				match: Object.values(items).filter((i) => i.label === "match").length,
				reject: Object.values(items).filter((i) => i.label === "reject").length,
				audited: 0,
				borderline: Object.values(items).filter((i) => i.confidence !== "high").length,
			},
		},
		items,
	};

	writeFileSync(m.out, JSON.stringify(v2, null, 2));
	console.log(`${m.id}: ${v2._meta.counts.total} items (${v2._meta.counts.match} match / ${v2._meta.counts.reject} reject, ${v2._meta.counts.borderline} borderline)`);
	if (dups.length) console.log(`  warnings:`, dups.slice(0, 3));
	console.log(`  → ${m.out}`);
}
