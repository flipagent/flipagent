/**
 * Apply human audit decisions to a v2 label file. Each decision either:
 *   - confirms label correct (model was wrong) → audited:true
 *   - flips label (model was right) → flips + audited:true + auditNote
 *   - marks borderline (judgement call) → confidence: medium + audited:true
 *
 * Usage: edit the DECISIONS array below to reflect your audit, then run:
 *   DATASET=casio-ga2100-1A node --import tsx scripts/apply-audit-decisions.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

const DATASET = process.env.DATASET;
if (!DATASET) throw new Error("DATASET env required");

interface RegistryEntry { id: string; labels: string; }
const registry = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as { datasets: RegistryEntry[] };
const cfg = registry.datasets.find((d) => d.id === DATASET);
if (!cfg) throw new Error(`Dataset '${DATASET}' not in registry`);

interface LabelsV2 {
	_meta: { datasetId: string; counts: Record<string, number>; auditHistory?: { date: string; action: string; auditor: string }[] };
	items: Record<string, { label: "match" | "reject"; note: string; confidence: string; audited: boolean; auditNote: string | null }>;
}

interface Decision {
	itemId: string;
	action: "confirm" | "flip" | "borderline";
	auditNote: string;
}

// EDIT THIS array per dataset — load from per-dataset decision file.
const DECISIONS_FILE = `scripts/.bench-out/audit-decisions-${DATASET}.json`;
const decisionsRaw = JSON.parse(readFileSync(DECISIONS_FILE, "utf8")) as { decisions: Decision[] };

const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
let confirmed = 0, flipped = 0, borderline = 0, missing = 0;

for (const d of decisionsRaw.decisions) {
	const it = labels.items[d.itemId];
	if (!it) { console.log(`  ! itemId ${d.itemId} not in label file`); missing++; continue; }
	if (d.action === "confirm") {
		it.audited = true;
		it.auditNote = d.auditNote;
		confirmed++;
	} else if (d.action === "flip") {
		it.label = it.label === "match" ? "reject" : "match";
		it.audited = true;
		it.auditNote = `flipped: ${d.auditNote}`;
		flipped++;
	} else if (d.action === "borderline") {
		it.confidence = "medium";
		it.audited = true;
		it.auditNote = d.auditNote;
		borderline++;
	}
}

labels._meta.counts = {
	total: Object.keys(labels.items).length,
	match: Object.values(labels.items).filter((i) => i.label === "match").length,
	reject: Object.values(labels.items).filter((i) => i.label === "reject").length,
	audited: Object.values(labels.items).filter((i) => i.audited).length,
	borderline: Object.values(labels.items).filter((i) => i.confidence !== "high").length,
};
if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
labels._meta.auditHistory.push({
	date: new Date().toISOString().slice(0, 10),
	action: `manual audit: ${confirmed} confirmed, ${flipped} flipped, ${borderline} borderline (${missing} missing)`,
	auditor: "claude-manual-review",
});

writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
console.log(`Applied to ${cfg.labels}: ${confirmed} confirmed, ${flipped} flipped, ${borderline} borderline, ${missing} missing.`);
console.log(`Counts now: total=${labels._meta.counts.total} match=${labels._meta.counts.match} reject=${labels._meta.counts.reject} audited=${labels._meta.counts.audited}`);
