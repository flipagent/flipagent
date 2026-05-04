/**
 * Initial labeling for a freshly-scaffolded dataset. Runs the production
 * matcher against every item in the snapshot pool, records the model's
 * decision as the gold label, and updates _meta with a clear
 * "matcher-proposed, not yet human-audited" marker.
 *
 * Use this to bootstrap a new dataset quickly. The labels are NOT a
 * proper accuracy benchmark for the same matcher (circular — matcher
 * scores 100% against its own decisions). They are useful as:
 *   - a starting point for line-by-line audit (see audit-labels.ts)
 *   - a stability test (re-run matcher: any disagreement = variance)
 *   - a generalisation test against a DIFFERENT model
 *
 * Usage:
 *   DATASET=samsung-s24-ultra-256gb \
 *     node --env-file=.env --import tsx scripts/auto-label-dataset.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";

const DATASET = process.env.DATASET!;
if (!DATASET) throw new Error("DATASET env required");
const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";

interface Reg { datasets: { id: string; snapshot: string; labels: string; seed: string }[]; }
interface Snap { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[]; }
interface LabelsV2 {
	_meta: { rule: string; counts: Record<string, number>; auditHistory?: { date: string; action: string; auditor: string }[] };
	items: Record<string, { label: "match" | "reject" | "TODO"; note: string; confidence: string; audited: boolean; auditNote: string | null }>;
}

async function main(): Promise<void> {
	const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as Reg;
	const cfg = reg.datasets.find((d) => d.id === DATASET);
	if (!cfg) throw new Error(`dataset ${DATASET} not in registry`);

	const snap = JSON.parse(readFileSync(cfg.snapshot, "utf8")) as Snap;
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as LabelsV2;

	const apiKey = (await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID)))[0];
	const fetchDetail = detailFetcherFor(apiKey);

	// Flush decision cache for this seed so we get fresh model decisions.
	await db.execute(sql`delete from match_decisions where candidate_id = ${cfg.seed}`).catch(() => undefined);

	const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
	const dedupedPool = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];

	console.log(`[auto-label] ${DATASET} seed=${snap.seed.itemId} pool=${dedupedPool.length}`);
	const t0 = Date.now();
	const r = await matchPoolWithLlm(snap.seed, dedupedPool, { useImages: false }, fetchDetail);
	const wall = Date.now() - t0;
	const matched = new Set(r.match.map((m) => m.item.itemId));
	const reasons = new Map<string, string>();
	for (const m of r.match) reasons.set(m.item.itemId, m.reason ?? "");
	for (const m of r.reject) reasons.set(m.item.itemId, m.reason ?? "");

	let nMatch = 0, nReject = 0;
	for (const itemId of Object.keys(labels.items)) {
		const isMatch = matched.has(itemId);
		labels.items[itemId]!.label = isMatch ? "match" : "reject";
		labels.items[itemId]!.confidence = "auto";
		labels.items[itemId]!.audited = false;
		labels.items[itemId]!.auditNote = `auto-labeled by matcher: ${reasons.get(itemId)?.slice(0, 100) ?? ""}`;
		if (isMatch) nMatch++;
		else nReject++;
	}

	labels._meta.counts = { total: Object.keys(labels.items).length, match: nMatch, reject: nReject, audited: 0 } as Record<string, number>;
	if (!labels._meta.auditHistory) labels._meta.auditHistory = [];
	labels._meta.auditHistory.push({
		date: new Date().toISOString().slice(0, 10),
		action: `auto-labeled by matcher (gemini-2.5-flash chunk=1) — ${nMatch} match / ${nReject} reject in ${wall}ms — NOT HUMAN-AUDITED, treat as bootstrap only`,
		auditor: "auto-label",
	});

	writeFileSync(cfg.labels, JSON.stringify(labels, null, 2));
	console.log(`[auto-label] → ${nMatch} match / ${nReject} reject (wall=${wall}ms)`);
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
