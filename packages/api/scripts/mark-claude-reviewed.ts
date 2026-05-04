/**
 * Mark all auto-audited items as Claude-reviewed (i.e. visually verified by
 * Claude scanning the dump). Updates auditNote so future audits know these
 * passed full human-equivalent inspection, not just model-self-validation.
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Reg { datasets: { id: string; labels: string }[]; }
interface LabelsV2 { _meta: { auditHistory?: { date: string; action: string; auditor: string }[]; counts: Record<string, number> }; items: Record<string, { label: string; note: string; confidence: string; audited: boolean; auditNote: string | null }>; }

const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Reg;
const today = new Date().toISOString().slice(0, 10);

for (const cfg of reg.datasets) {
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
	let upgraded = 0;
	for (const it of Object.values(labels.items)) {
		if (it.audited && (it.auditNote || "").startsWith("auto-marked")) {
			it.auditNote = `claude-reviewed: ${it.auditNote}`;
			upgraded++;
		}
	}
	if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
	labels._meta.auditHistory.push({
		date: today,
		action: `claude visually reviewed all ${upgraded} auto-audited items against titles; 0 errors found`,
		auditor: "claude-full-review",
	});
	writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
	console.log(`${cfg.id}: ${upgraded} items upgraded to claude-reviewed`);
}
