/**
 * Show which specific items the matcher disagrees with the gold labels.
 * Run after match-regression to inspect each FP/FN with full title + price + condition.
 *
 * Usage: node --env-file=.env --import tsx scripts/match-disagreements.ts
 *   FILTER=iphone,jordan  (optional)
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys, type ApiKey } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";

const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";
const FILTER = process.env.FILTER ? process.env.FILTER.split(",") : null;

interface RegistryEntry { id: string; snapshot: string; labels: string; seed: string; }
interface Registry { datasets: RegistryEntry[]; }
interface LabelsV2 { _meta: { seed: { itemId: string; title: string }; rule: string }; items: Record<string, { label: "match" | "reject"; note: string; auditNote: string | null }>; }
interface Snap { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[]; }

async function loadApiKey(): Promise<ApiKey | undefined> {
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
	return rows[0];
}

async function main(): Promise<void> {
	const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Registry;
	const datasets = FILTER ? reg.datasets.filter((d) => FILTER.some((f) => d.id.includes(f))) : reg.datasets;
	const apiKey = await loadApiKey();
	const fetchDetail = detailFetcherFor(apiKey);

	for (const cfg of datasets) {
		const snap = JSON.parse(readFileSync(cfg.snapshot, "utf8")) as Snap;
		const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;

		await db.execute(sql`delete from match_decisions where candidate_id = ${cfg.seed}`).catch(() => undefined);

		const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
		const pool = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];
		const itemMap = new Map(pool.map((p) => [p.itemId, p]));

		const r = await matchPoolWithLlm(snap.seed, pool, { useImages: false }, fetchDetail);
		const matched = new Set<string>();
		const reasons = new Map<string, string>();
		for (const m of r.match) { matched.add(m.item.itemId); reasons.set(m.item.itemId, m.reason ?? ""); }
		for (const m of r.reject) reasons.set(m.item.itemId, m.reason ?? "");

		const fps: string[] = [];
		const fns: string[] = [];
		for (const [id, lab] of Object.entries(labels.items)) {
			const pred = matched.has(id);
			const gold = lab.label === "match";
			if (pred && !gold) fps.push(id);
			if (!pred && gold) fns.push(id);
		}

		console.log("════════════════════════════════════════════════════════════════════════════════");
		console.log(`${cfg.id}   FP=${fps.length}  FN=${fns.length}`);
		console.log(`SEED: ${snap.seed.title}`);
		console.log(`RULE: ${labels._meta.rule.slice(0, 200)}`);
		console.log("════════════════════════════════════════════════════════════════════════════════");

		const dump = (kind: "FP" | "FN", ids: string[]) => {
			if (ids.length === 0) return;
			console.log(`\n--- ${kind} (${kind === "FP" ? "model said MATCH, gold REJECT" : "model said REJECT, gold MATCH"}) ---`);
			for (const id of ids) {
				const it = itemMap.get(id);
				const lab = labels.items[id]!;
				const price = it?.lastSoldPrice?.value ?? it?.price?.value ?? "?";
				const aspects: Record<string, string> = {};
				for (const a of (it?.localizedAspects ?? [])) aspects[a.name] = a.value;
				const aspectsStr = Object.entries(aspects).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(" | ");
				console.log(`  [${id}]  $${price}  ${it?.condition ?? "?"}`);
				console.log(`    title:    ${it?.title}`);
				if (aspectsStr) console.log(`    aspects:  ${aspectsStr}`);
				console.log(`    goldNote: ${lab.note.slice(0, 120)}`);
				console.log(`    audit:    ${lab.auditNote ?? "(none)"}`);
				console.log(`    modelSay: ${(reasons.get(id) ?? "").slice(0, 200)}`);
				console.log("");
			}
		};
		dump("FP", fps);
		dump("FN", fns);
	}
	process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
