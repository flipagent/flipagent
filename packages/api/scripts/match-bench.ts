/**
 * Run matcher in isolation, bypassing the 90s match:hosted cache wrapper.
 *
 * Two modes:
 *   MODE=snapshot — fetch detail + sold + active, save raw pool to disk.
 *                   Skips the matcher.
 *   MODE=match    — load a saved snapshot, run matchPoolWithLlm against it
 *                   (with MATCHER_TRACE=1 sub-stage timing) and dump the
 *                   match decisions back to disk for downstream labeling.
 *
 * Provider/model is whatever LLM_PROVIDER + *_MODEL env says — switch them
 * between runs to bake off models against the SAME pool snapshot.
 *
 *   MODE=snapshot ITEM_ID="v1|...|0" APIKEY_ID=<uuid> \
 *     node --env-file=.env --import tsx scripts/match-bench.ts
 *
 *   MODE=match SNAPSHOT=scripts/.bench-out/snap-XYZ.json \
 *     LLM_PROVIDER=anthropic ANTHROPIC_MODEL=claude-haiku-4-5 \
 *     MATCHER_TRACE=1 \
 *     node --env-file=.env --import tsx scripts/match-bench.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys, type ApiKey } from "../src/db/schema.js";
import { tierConditionIdsFor } from "../src/services/items/condition-tier.js";
import { detailFetcherFor, getItemDetail } from "../src/services/items/detail.js";
import { searchActiveListings } from "../src/services/items/search.js";
import { searchSoldListings } from "../src/services/items/sold.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";
import { pickProvider } from "../src/services/match/llm/index.js";
import { parseItemId } from "../src/utils/item-id.js";

const MODE = process.env.MODE ?? "snapshot";
const OUT_DIR = process.env.OUT_DIR ?? "scripts/.bench-out";
mkdirSync(OUT_DIR, { recursive: true });

async function loadApiKey(id: string | undefined): Promise<ApiKey | undefined> {
	if (!id) return undefined;
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
	return rows[0];
}

async function snapshotMode(): Promise<void> {
	const itemId = process.env.ITEM_ID;
	if (!itemId) throw new Error("ITEM_ID required");
	const parsed = parseItemId(itemId);
	if (!parsed) throw new Error(`bad ITEM_ID ${itemId}`);
	const apiKey = await loadApiKey(process.env.APIKEY_ID);

	console.log(`[snap] item=${itemId}`);
	const t0 = performance.now();
	const detail = await getItemDetail(parsed.legacyId, { apiKey, variationId: parsed.variationId });
	if (!detail) throw new Error("no detail");
	console.log(`[snap] detail        ${Math.round(performance.now() - t0)}ms  source=${detail.source}`);

	const q = detail.body.title.trim();
	const DAY_MS = 86_400_000;
	const lookbackDays = 90;
	const sinceMs = Math.floor(Date.now() / DAY_MS) * DAY_MS - lookbackDays * DAY_MS;
	const since = new Date(sinceMs).toISOString();
	const lookbackFilter = `lastSoldDate:[${since}..]`;

	const candidateConditionIds = tierConditionIdsFor(detail.body.conditionId);
	const conditionFilter = candidateConditionIds ? `conditionIds:{${candidateConditionIds.join("|")}}` : null;
	const soldFilter = conditionFilter ? `${lookbackFilter},${conditionFilter}` : lookbackFilter;
	const activeFilter = conditionFilter ?? undefined;
	console.log(`[snap] candidate condition=${detail.body.condition} (id=${detail.body.conditionId}) tier filter=${conditionFilter ?? "(none)"}`);

	const t1 = performance.now();
	const [sold, active] = await Promise.all([
		searchSoldListings({ q, limit: 50, filter: soldFilter }, { apiKey }),
		searchActiveListings({ q, limit: 50, filter: activeFilter }, { apiKey }),
	]);
	console.log(`[snap] search        ${Math.round(performance.now() - t1)}ms  sold=${sold.body.itemSales?.length ?? 0} active=${active.body.itemSummaries?.length ?? 0}`);

	const soldItems = sold.body.itemSales ?? sold.body.itemSummaries ?? [];
	const activeItems = active.body.itemSummaries ?? [];

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const snap = {
		stamp,
		itemId,
		query: q,
		seed: detail.body,
		soldRaw: soldItems,
		activeRaw: activeItems,
		soldSource: sold.source,
		activeSource: active.source,
		seedSource: detail.source,
	};
	const path = `${OUT_DIR}/snap-${stamp}.json`;
	writeFileSync(path, JSON.stringify(snap, null, 2));
	console.log(`[snap] → ${path}`);
}

async function matchMode(): Promise<void> {
	const snapPath = process.env.SNAPSHOT;
	if (!snapPath) throw new Error("SNAPSHOT path required");
	const apiKey = await loadApiKey(process.env.APIKEY_ID);
	const snap = JSON.parse(readFileSync(snapPath, "utf8")) as {
		stamp: string;
		itemId: string;
		query: string;
		seed: ItemSummary;
		soldRaw: ItemSummary[];
		activeRaw: ItemSummary[];
	};

	const provider = pickProvider();
	console.log(`[match] provider=${provider.name} model=${provider.model}`);
	console.log(`[match] snapshot=${snapPath}  pool: sold=${snap.soldRaw.length} active=${snap.activeRaw.length}`);

	// Mimic runMatchFilter dedup logic.
	const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
	const dedupedPool: ItemSummary[] = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];
	console.log(`[match] deduped pool=${dedupedPool.length}`);

	const useImages = process.env.USE_IMAGES !== "false";
	console.log(`[match] useImages=${useImages}`);
	const t0 = performance.now();
	const result = await matchPoolWithLlm(snap.seed, dedupedPool, { useImages }, detailFetcherFor(apiKey));
	const totalMs = Math.round(performance.now() - t0);
	console.log(`[match] TOTAL ${totalMs}ms  match=${result.totals.match} reject=${result.totals.reject}`);

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const verifyChunk = process.env.VERIFY_CHUNK ?? "10";
	const out = {
		stamp,
		snapPath,
		itemId: snap.itemId,
		provider: provider.name,
		model: provider.model,
		verifyChunk: Number.parseInt(verifyChunk, 10),
		strategy: "single",
		useImages,
		totalMs,
		match: result.match.map((m) => ({ itemId: m.item.itemId, title: m.item.title, reason: m.reason, url: m.item.itemWebUrl })),
		reject: result.reject.map((m) => ({ itemId: m.item.itemId, title: m.item.title, reason: m.reason, url: m.item.itemWebUrl })),
	};
	const path = `${OUT_DIR}/match-${provider.model}-c${verifyChunk}-single-${stamp}.json`;
	writeFileSync(path, JSON.stringify(out, null, 2));
	console.log(`[match] → ${path}`);
}

async function main(): Promise<void> {
	if (MODE === "snapshot") await snapshotMode();
	else if (MODE === "match") await matchMode();
	else throw new Error(`bad MODE ${MODE}`);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("[bench] fatal:", err);
		process.exit(1);
	});
