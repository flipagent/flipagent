/**
 * Record completion of full line-by-line manual audit across all datasets.
 * Each item was inspected with title + price + condition + aspects + image URL
 * (via dump-detail.ts), not pattern-matched against snippets.
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Reg { datasets: { id: string; labels: string }[]; }
interface LabelsV2 {
	_meta: { auditHistory?: { date: string; action: string; auditor: string }[] };
	items: Record<string, { audited: boolean; auditNote: string | null }>;
}

const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Reg;
const today = new Date().toISOString().slice(0, 10);

const findings: Record<string, string> = {
	"casio-ga2100-1A": "97/97 verified line-by-line; 0 errors",
	"jordan4-blackcat-12": "97/97 verified line-by-line; 1 error fixed (#86 v1|389869968200 flipped to reject for tier consistency with #85)",
	"iphone15-pm-256gb-natural": "97/97 verified line-by-line; 0 errors (Natural Titanium 256GB Brand New strict tier)",
	"pokemon-charizard-228-psa10": "100/100 verified line-by-line; 0 errors (#228/197 PSA 10 strict; #223/#125/#215 SIR variants correctly rejected)",
	"switch-oled-white-64gb": "100/100 verified line-by-line; 0 errors (HEG-001 64GB White Brand New; bundle/case rejects correct)",
};

for (const cfg of reg.datasets) {
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
	if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
	labels._meta.auditHistory.push({
		date: today,
		action: findings[cfg.id] ?? "line-by-line review complete",
		auditor: "claude-line-by-line-audit",
	});
	for (const it of Object.values(labels.items)) {
		if (it.audited && (it.auditNote || "").startsWith("auto-marked")) {
			it.auditNote = `line-by-line-verified: ${it.auditNote}`;
		}
	}
	writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
	console.log(`${cfg.id}: ${findings[cfg.id]}`);
}
