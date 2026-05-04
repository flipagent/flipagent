/**
 * Dump per-item full detail for manual line-by-line audit.
 * For each labeled item: itemId, current label, title, price, condition,
 * full aspects, and image URL (for selective image inspection).
 */
import { readFileSync } from "node:fs";

const DATASET = process.env.DATASET!;
if (!DATASET) throw new Error("DATASET env required");

interface Reg { datasets: { id: string; snapshot: string; labels: string }[]; }
interface LabelsV2 { _meta: { rule: string; seed: { itemId: string; title: string } }; items: Record<string, { label: string; note: string; confidence: string; audited: boolean; auditNote: string | null }>; }
interface Snap { seed: any; soldRaw: any[]; activeRaw: any[]; }

const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Reg;
const cfg = reg.datasets.find((d) => d.id === DATASET);
if (!cfg) throw new Error(`Dataset ${DATASET} not in registry`);

const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
const snap = JSON.parse(readFileSync(cfg.snapshot, "utf8")) as Snap;
const itemMap = new Map<string, any>();
[...snap.soldRaw, ...snap.activeRaw].forEach((it) => itemMap.set(it.itemId, it));

console.log(`════════════════════════════════════════════════════════════════════════════════`);
console.log(`DATASET: ${DATASET}`);
console.log(`SEED:    ${labels._meta.seed.title}`);
console.log(`RULE:    ${labels._meta.rule.slice(0, 250)}`);
console.log(`════════════════════════════════════════════════════════════════════════════════`);
console.log("");

const sortedIds = [...Object.keys(labels.items)].sort();
let n = 0;
for (const itemId of sortedIds) {
	n++;
	const lab = labels.items[itemId]!;
	const it = itemMap.get(itemId);
	if (!it) {
		console.log(`#${String(n).padStart(3)} ${itemId} — NOT IN POOL`);
		continue;
	}
	const price = it.lastSoldPrice?.value || it.price?.value || "?";
	const aspects: Record<string, string> = {};
	for (const a of (it.localizedAspects ?? [])) aspects[a.name] = a.value;
	const aspectsStr = Object.entries(aspects).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(" | ");

	console.log(`#${String(n).padStart(3)} [${lab.label.toUpperCase().padEnd(6)}] $${String(price).padEnd(8)} ${(it.condition ?? "?").padEnd(13)} ${itemId}`);
	console.log(`    title:  ${it.title}`);
	if (aspectsStr) console.log(`    aspects: ${aspectsStr}`);
	console.log(`    note:    ${lab.note.slice(0, 100)}`);
	console.log(`    image:   ${it.image?.imageUrl ?? "(none)"}`);
	console.log(`    url:     ${it.itemWebUrl ?? "?"}`);
	console.log("");
}
console.log(`Total: ${n} items in pool, ${Object.keys(labels.items).length} in labels`);
