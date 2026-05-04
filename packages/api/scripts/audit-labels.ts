/**
 * Surface every model-vs-label disagreement on a labeled dataset with FULL
 * context (title, price, aspects, model's reason). Output is plain text that
 * the operator (or Claude) can review item-by-item to decide whether the
 * label is wrong, the model is wrong, or it's a borderline call.
 *
 *   DATASET=casio-ga2100-1A REPS=3 \
 *     node --env-file=.env --import tsx scripts/audit-labels.ts
 *
 * For each disagreement reports:
 *   - itemId
 *   - title + price + condition + key aspects
 *   - current label + note + confidence
 *   - model decision (count across reps) + most-common reason
 *
 * Then prints suggested actions:
 *   "X agree with model in N/N reps — flip label?"
 *   "Y model agrees with label in N/N reps — confirm label correct (mark audited)"
 */

import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys, type ApiKey } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";

const DATASET_ID = process.env.DATASET;
if (!DATASET_ID) throw new Error("DATASET env required (e.g. DATASET=casio-ga2100-1A)");
const REPS = Number.parseInt(process.env.REPS ?? "3", 10);
const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";

interface RegistryEntry { id: string; snapshot: string; labels: string; seed: string; }
interface Registry { datasets: RegistryEntry[]; }
const registry = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Registry;
const cfg = registry.datasets.find((d) => d.id === DATASET_ID);
if (!cfg) throw new Error(`Dataset '${DATASET_ID}' not in registry`);

interface LabelsV2 {
	_meta: { datasetId: string; counts: Record<string, number> };
	items: Record<string, { label: "match" | "reject"; note: string; confidence: string; audited: boolean; auditNote: string | null }>;
}
interface Snap { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[]; }

const snap = JSON.parse(readFileSync(cfg.snapshot, "utf8")) as Snap;
const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;
const apiKeyRows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
const apiKey: ApiKey | undefined = apiKeyRows[0];
const fetchDetail = detailFetcherFor(apiKey);

const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
const dedupedPool: ItemSummary[] = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];
const itemById = new Map(dedupedPool.map((it) => [it.itemId, it]));

console.log(`[audit] dataset=${cfg.id} pool=${dedupedPool.length} reps=${REPS}`);
console.log(`[audit] seed: ${snap.seed.title}`);
console.log("");

interface PerItem { matchCount: number; rejectCount: number; reasons: string[]; }
const tally = new Map<string, PerItem>();

for (let r = 0; r < REPS; r++) {
	await db.execute(sql`delete from match_decisions where candidate_id = ${cfg.seed}`).catch(() => undefined);
	const t0 = performance.now();
	const result = await matchPoolWithLlm(snap.seed, dedupedPool, { useImages: false }, fetchDetail);
	console.log(`  rep${r+1}: ${Math.round(performance.now() - t0)}ms  match=${result.totals.match} reject=${result.totals.reject}`);
	for (const m of result.match) {
		const t = tally.get(m.item.itemId) ?? { matchCount: 0, rejectCount: 0, reasons: [] };
		t.matchCount++;
		if (m.reason) t.reasons.push(`MATCH: ${m.reason}`);
		tally.set(m.item.itemId, t);
	}
	for (const m of result.reject) {
		const t = tally.get(m.item.itemId) ?? { matchCount: 0, rejectCount: 0, reasons: [] };
		t.rejectCount++;
		if (m.reason) t.reasons.push(`REJECT: ${m.reason}`);
		tally.set(m.item.itemId, t);
	}
}

console.log("");
console.log("═".repeat(80));
console.log(" DISAGREEMENTS — model vs label");
console.log("═".repeat(80));

interface Disagreement {
	itemId: string;
	title: string;
	price: string;
	condition: string;
	color: string;
	storage: string;
	size: string;
	currentLabel: "match" | "reject";
	currentNote: string;
	currentConfidence: string;
	currentAudited: boolean;
	modelMatchCount: number;
	modelRejectCount: number;
	consistency: "consistent" | "split";
	dominantModelDecision: "match" | "reject";
	mostCommonReason: string;
	suggested: string;
}

const disagreements: Disagreement[] = [];
const aligned: { itemId: string; consistent: boolean }[] = [];

for (const [itemId, lab] of Object.entries(labels.items)) {
	const t = tally.get(itemId);
	if (!t) continue;
	const total = t.matchCount + t.rejectCount;
	if (total === 0) continue;
	const dominant: "match" | "reject" = t.matchCount > t.rejectCount ? "match" : "reject";
	const consistent = t.matchCount === 0 || t.rejectCount === 0;
	if (dominant === lab.label) {
		aligned.push({ itemId, consistent });
		continue;
	}
	const item = itemById.get(itemId);
	const aspects: Record<string, string> = {};
	for (const a of (item as ItemSummary & { localizedAspects?: { name: string; value: string }[] })?.localizedAspects ?? []) {
		aspects[a.name] = a.value;
	}
	const reasonCounts = new Map<string, number>();
	for (const r of t.reasons.filter((x) => x.startsWith(dominant === "match" ? "MATCH" : "REJECT"))) {
		reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
	}
	const mostCommon = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "(no reason)";
	const suggested = consistent
		? `Model ${dominant} ${total}/${total} reps. Strong signal — consider flipping label to "${dominant}".`
		: `Model split ${t.matchCount}m/${t.rejectCount}r — borderline. Mark confidence:medium.`;
	disagreements.push({
		itemId,
		title: item?.title ?? "?",
		price: String(item?.price?.value ?? item?.lastSoldPrice?.value ?? "?"),
		condition: item?.condition ?? "?",
		color: aspects.Color ?? "",
		storage: aspects["Storage Capacity"] ?? "",
		size: aspects.Size ?? aspects["US Shoe Size"] ?? "",
		currentLabel: lab.label,
		currentNote: lab.note,
		currentConfidence: lab.confidence,
		currentAudited: lab.audited,
		modelMatchCount: t.matchCount,
		modelRejectCount: t.rejectCount,
		consistency: consistent ? "consistent" : "split",
		dominantModelDecision: dominant,
		mostCommonReason: mostCommon,
		suggested,
	});
}

console.log(`\nTotal items in labels: ${Object.keys(labels.items).length}`);
console.log(`Pool items checked: ${tally.size}`);
console.log(`Aligned (model agrees with label): ${aligned.length}  (${aligned.filter((a) => a.consistent).length} consistent across all reps)`);
console.log(`Disagreements: ${disagreements.length}`);
console.log("");

for (const d of disagreements.sort((a, b) => (a.consistency === b.consistency ? 0 : a.consistency === "consistent" ? -1 : 1))) {
	console.log("─".repeat(80));
	console.log(`itemId: ${d.itemId}`);
	console.log(`title : ${d.title}`);
	console.log(`price : $${d.price}    condition: ${d.condition}    color: ${d.color}    storage: ${d.storage}    size: ${d.size}`);
	console.log(`label : ${d.currentLabel}  (confidence:${d.currentConfidence}, audited:${d.currentAudited})  — "${d.currentNote}"`);
	console.log(`model : ${d.dominantModelDecision} (${d.modelMatchCount}m/${d.modelRejectCount}r) ${d.consistency === "consistent" ? "CONSISTENT" : "SPLIT"}`);
	console.log(`        reason: ${d.mostCommonReason}`);
	console.log(`>>>>>   ${d.suggested}`);
}

console.log("");
console.log("═".repeat(80));
console.log(" Auto-mark items where model agreed with label across all reps as audited:true");
console.log("═".repeat(80));

let autoAuditedCount = 0;
for (const a of aligned) {
	if (!a.consistent) continue;
	const lab = labels.items[a.itemId];
	if (!lab || lab.audited) continue;
	lab.audited = true;
	lab.auditNote = `auto-marked: model agreed with label ${REPS}/${REPS} reps`;
	autoAuditedCount++;
}
labels._meta.counts.audited = Object.values(labels.items).filter((l) => l.audited).length;
const lastAuditDate = new Date().toISOString().slice(0, 10);
const meta = labels._meta as unknown as { auditHistory?: { date: string; action: string; auditor: string }[] };
if (!meta.auditHistory) meta.auditHistory = [];
meta.auditHistory.push({ date: lastAuditDate, action: `auto-audited ${autoAuditedCount} items where model agreed in ${REPS}/${REPS} reps; ${disagreements.length} disagreements remain for manual review`, auditor: "audit-labels.ts" });
writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
console.log(`Auto-audited: ${autoAuditedCount} items (now total audited: ${labels._meta.counts.audited}/${Object.keys(labels.items).length})`);
console.log(`Disagreements remaining for manual review: ${disagreements.length}`);
console.log(`Updated label file: ${cfg.labels}`);
process.exit(0);
