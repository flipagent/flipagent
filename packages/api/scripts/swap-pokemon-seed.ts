/**
 * One-shot: swap the pokemon-charizard-228-psa10 dataset's seed from
 * v1|297685135942 (which has miscoded conditionDescriptors Grade=6) to
 * v1|177924507297 (clean — no conditionDescriptors, title says PSA 10).
 *
 * Same eBay search results stay valid — both candidate items are the
 * same product, share the same comp pool. Only the seed reference + the
 * metadata block change.
 */
import { readFileSync, writeFileSync } from "node:fs";

const NEW_SEED_ID = "v1|177924507297|0";
const SNAPSHOT = "scripts/.bench-out/snap-2026-05-03T17-26-37-182Z.json";
const LABELS = "scripts/.bench-out/labels-pokemon-charizard-228-psa10.v2.json";
const REGISTRY = "scripts/.bench-out/datasets.json";

interface Snap { seed: { itemId: string; title?: string }; soldRaw: any[]; activeRaw: any[]; }
interface LabelsV2 { _meta: { seed: { itemId: string; title: string }; auditHistory?: any[] }; items: Record<string, any>; }
interface Reg { datasets: { id: string; seed: string }[]; }

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snap;
const labels = JSON.parse(readFileSync(LABELS, "utf8")) as LabelsV2;
const reg = JSON.parse(readFileSync(REGISTRY, "utf8")) as Reg;

const all = [...snap.soldRaw, ...snap.activeRaw];
const newSeedItem = all.find((it: any) => it.itemId === NEW_SEED_ID);
if (!newSeedItem) throw new Error(`new seed ${NEW_SEED_ID} not found in snapshot pool`);

console.log(`Old seed: ${snap.seed.itemId}  ${snap.seed.title?.slice(0, 80) ?? "?"}`);
console.log(`New seed: ${newSeedItem.itemId}  ${newSeedItem.title.slice(0, 80)}`);

snap.seed = newSeedItem;
writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
console.log(`✓ snapshot.seed updated`);

labels._meta.seed = { itemId: newSeedItem.itemId, title: newSeedItem.title };
if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
labels._meta.auditHistory.push({
	date: new Date().toISOString().slice(0, 10),
	action: `seed swapped from v1|297685135942 → ${NEW_SEED_ID} (old had miscoded conditionDescriptors Grade=6 — confused matcher under gemini-3.1-flash-lite-preview)`,
	auditor: "claude-seed-cleanup",
});
writeFileSync(LABELS, JSON.stringify(labels, null, 2));
console.log(`✓ labels._meta.seed updated`);

const ds = reg.datasets.find((d) => d.id === "pokemon-charizard-228-psa10");
if (ds) {
	ds.seed = NEW_SEED_ID;
	writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
	console.log(`✓ registry seed updated`);
}

console.log("Done.");
