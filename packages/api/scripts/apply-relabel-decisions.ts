/**
 * Apply the manual relabel decisions in
 * scripts/.bench-out/audit-decisions-relabel-2026-05-03.json. Each
 * decision is one of:
 *   - "flip"   — toggle the label (match → reject or reject → match)
 *   - "confirm" — leave label, just record the audit note
 *
 * Updates labels.items[itemId].label / .audited / .auditNote and
 * appends to labels._meta.auditHistory.
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Reg { datasets: { id: string; labels: string }[]; }
interface LabelsV2 {
	_meta: { counts: Record<string, number>; auditHistory?: { date: string; action: string; auditor: string }[] };
	items: Record<string, { label: "match" | "reject"; note: string; audited: boolean; auditNote: string | null }>;
}

const DECISIONS = "scripts/.bench-out/audit-decisions-relabel-2026-05-03.json";

const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Reg;
const decisions = JSON.parse(readFileSync(DECISIONS, "utf8")) as {
	_meta: { auditDate: string; auditor: string; summary: string };
	datasets: Record<string, { itemId: string; action: "flip" | "confirm"; auditNote: string }[]>;
};

for (const [datasetId, decisionList] of Object.entries(decisions.datasets)) {
	const cfg = reg.datasets.find((d) => d.id === datasetId);
	if (!cfg) { console.log(`! ${datasetId} not in registry`); continue; }
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
	let flipped = 0, confirmed = 0;
	for (const d of decisionList) {
		const it = labels.items[d.itemId];
		if (!it) { console.log(`  ! ${datasetId}/${d.itemId} not found in labels`); continue; }
		if (d.action === "flip") {
			it.label = it.label === "match" ? "reject" : "match";
			it.audited = true;
			it.auditNote = `flipped ${decisions._meta.auditDate}: ${d.auditNote}`;
			flipped++;
		} else {
			it.audited = true;
			it.auditNote = d.auditNote;
			confirmed++;
		}
	}
	labels._meta.counts = {
		total: Object.keys(labels.items).length,
		match: Object.values(labels.items).filter((i) => i.label === "match").length,
		reject: Object.values(labels.items).filter((i) => i.label === "reject").length,
		audited: Object.values(labels.items).filter((i) => i.audited).length,
	};
	if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
	labels._meta.auditHistory.push({
		date: decisions._meta.auditDate,
		action: `relabel after chunk=1 baseline: ${flipped} flipped, ${confirmed} confirmed`,
		auditor: decisions._meta.auditor,
	});
	writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
	console.log(`  ${datasetId}: ${flipped} flipped, ${confirmed} confirmed → match=${labels._meta.counts.match} reject=${labels._meta.counts.reject}`);
}
