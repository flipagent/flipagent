/**
 * Apply finishup audit decisions across multiple datasets in one pass.
 * Schema: { datasets: { <id>: [decisions...] } }
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Reg { datasets: { id: string; labels: string }[]; }
interface LabelsV2 {
	_meta: { counts: Record<string, number>; auditHistory?: { date: string; action: string; auditor: string }[] };
	items: Record<string, { label: "match" | "reject"; note: string; confidence: string; audited: boolean; auditNote: string | null }>;
}

const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Reg;
const decisions = JSON.parse(readFileSync("scripts/.bench-out/audit-decisions-finishup.json", "utf8")) as { datasets: Record<string, { itemId: string; action: string; auditNote: string }[]> };

for (const [datasetId, decisionList] of Object.entries(decisions.datasets)) {
	const cfg = reg.datasets.find((d) => d.id === datasetId);
	if (!cfg) { console.log(`! ${datasetId} not in registry`); continue; }
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
	let confirmed = 0, flipped = 0;
	for (const d of decisionList) {
		const it = labels.items[d.itemId];
		if (!it) continue;
		if (d.action === "confirm") { it.audited = true; it.auditNote = d.auditNote; confirmed++; }
		else if (d.action === "flip") { it.label = it.label === "match" ? "reject" : "match"; it.audited = true; it.auditNote = `flipped: ${d.auditNote}`; flipped++; }
	}
	labels._meta.counts.audited = Object.values(labels.items).filter((i) => i.audited).length;
	labels._meta.counts.match = Object.values(labels.items).filter((i) => i.label === "match").length;
	labels._meta.counts.reject = Object.values(labels.items).filter((i) => i.label === "reject").length;
	if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
	labels._meta.auditHistory.push({ date: new Date().toISOString().slice(0, 10), action: `finishup audit: ${confirmed} confirmed, ${flipped} flipped`, auditor: "claude-finishup" });
	writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
	console.log(`  ${datasetId}: ${confirmed} confirmed, ${flipped} flipped → audited=${labels._meta.counts.audited}/${labels._meta.counts.total}`);
}
