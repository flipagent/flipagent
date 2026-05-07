/**
 * Re-runs evaluate live for each of the 18 seeds that had "suspect price"
 * rejects in match_history. Clears all relevant caches first so the fresh
 * matcher run produces apples-to-apples output. Compares per-seed:
 *   - rejection counts before/after
 *   - which old rejects flipped to MATCH
 *   - which old rejects now flow to suspiciousIds (LLM kept, quant filtered)
 *
 * Usage:
 *   APIKEY_ID=<uuid> node --env-file=.env --import tsx scripts/sweep-suspect-seeds.ts
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys, listingObservations, matchDecisions, matchHistory, marketDataCache, proxyResponseCache } from "../src/db/schema.js";
import type { ApiKey } from "../src/db/schema.js";
import { runEvaluatePipeline } from "../src/services/evaluate/run.js";

const APIKEY_ID = process.env.APIKEY_ID;
if (!APIKEY_ID) {
	console.error("APIKEY_ID required");
	process.exit(1);
}

const SEEDS_QUERY = sql`
	SELECT DISTINCT candidate_id FROM match_history
	WHERE decision='reject' AND reason='suspect price (likely replica)'
	ORDER BY candidate_id
`;

interface PriorReject {
	itemId: string;
	reason: string;
	itemTitle: string;
}

async function main(): Promise<void> {
	const apiKeyRows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
	const apiKey: ApiKey | undefined = apiKeyRows[0];
	if (!apiKey) throw new Error(`api_key ${APIKEY_ID} not found`);

	const seedRows = await db
		.selectDistinct({ candidateId: matchHistory.candidateId })
		.from(matchHistory)
		.where(sql`${matchHistory.decision}='reject' AND ${matchHistory.reason}='suspect price (likely replica)'`)
		.orderBy(matchHistory.candidateId);
	const seeds = seedRows.map((r) => r.candidateId);

	console.log(`# Sweeping ${seeds.length} seeds with new prompt + suspicious filter\n`);

	for (const seed of seeds) {
		const legacy = seed.split("|")[1] ?? seed;
		const seedSnap = await db
			.select({ title: listingObservations.title })
			.from(listingObservations)
			.where(eq(listingObservations.legacyItemId, legacy))
			.orderBy(sql`observed_at DESC`)
			.limit(1);
		const seedTitle = (seedSnap[0]?.title ?? "?").slice(0, 70);

		// Snapshot prior rejects for diff
		const priorRejects = await db
			.select({ itemId: matchHistory.itemId, reason: matchHistory.reason })
			.from(matchHistory)
			.where(sql`${matchHistory.candidateId}=${seed} AND ${matchHistory.decision}='reject'`);
		const priorRejectMap = new Map<string, string>();
		for (const r of priorRejects) {
			if (!priorRejectMap.has(r.itemId)) priorRejectMap.set(r.itemId, r.reason ?? "");
		}
		const priorPriceRejects = Array.from(priorRejectMap.entries()).filter(
			([, reason]) => reason.toLowerCase().includes("suspect price"),
		);
		const priorMpnRejects = Array.from(priorRejectMap.entries()).filter(
			([, reason]) => reason.toLowerCase().includes("mpn"),
		);

		// Clear caches so the matcher re-runs fresh
		await db.delete(proxyResponseCache).where(eq(proxyResponseCache.path, "internal:match"));
		await db.delete(marketDataCache).where(eq(marketDataCache.itemId, seed));
		await db.delete(matchDecisions).where(eq(matchDecisions.candidateId, seed));

		console.log(`\n━━━━━ ${seed} ━━━━━`);
		console.log(`  ${seedTitle}`);
		console.log(`  prior: ${priorRejects.length} rejects (${priorPriceRejects.length} price, ${priorMpnRejects.length} MPN)`);

		const t0 = performance.now();
		try {
			const result = await runEvaluatePipeline({ itemId: seed, apiKey });
			const totalMs = Math.round(performance.now() - t0);

			const newRejected = new Map<string, string>();
			for (const it of result.rejectedSoldPool ?? []) newRejected.set(it.itemId, result.rejectionReasons?.[it.itemId] ?? "");
			for (const it of result.rejectedActivePool ?? []) newRejected.set(it.itemId, result.rejectionReasons?.[it.itemId] ?? "");

			const r = result as typeof result & { suspiciousIds?: Record<string, { reason: string; pFraud: number }> };
			const suspiciousIds = r.suspiciousIds ?? {};

			console.log(`  new: ${newRejected.size} rejects + ${Object.keys(suspiciousIds).length} suspicious-flagged (${totalMs}ms)`);

			// Diffs
			const priceFlipped: string[] = [];
			const priceStillReject: string[] = [];
			const priceFlaggedSus: string[] = [];
			for (const [itemId] of priorPriceRejects) {
				if (suspiciousIds[itemId]) {
					priceFlaggedSus.push(itemId);
				} else if (newRejected.has(itemId)) {
					priceStillReject.push(`${itemId}: ${newRejected.get(itemId)?.slice(0, 60)}`);
				} else {
					priceFlipped.push(itemId);
				}
			}

			const mpnFlipped: string[] = [];
			const mpnStillReject: string[] = [];
			for (const [itemId] of priorMpnRejects) {
				if (newRejected.has(itemId)) {
					const r = newRejected.get(itemId) ?? "";
					if (r.toLowerCase().includes("mpn")) {
						mpnStillReject.push(`${itemId}: ${r.slice(0, 60)}`);
					} else {
						// Different reason now — count as different decision
						mpnStillReject.push(`${itemId}: now → ${r.slice(0, 60)}`);
					}
				} else {
					mpnFlipped.push(itemId);
				}
			}

			if (priceFlipped.length > 0) console.log(`    ★ price→MATCH: ${priceFlipped.length}`);
			if (priceFlaggedSus.length > 0) console.log(`    ⚠ price→suspicious: ${priceFlaggedSus.length}`);
			if (priceStillReject.length > 0) {
				console.log(`    · price still rejected: ${priceStillReject.length}`);
				for (const s of priceStillReject.slice(0, 3)) console.log(`        ${s}`);
			}
			if (mpnFlipped.length > 0) console.log(`    ★ MPN→MATCH: ${mpnFlipped.length}`);
			if (mpnStillReject.length > 0) {
				console.log(`    · MPN still rejected: ${mpnStillReject.length}`);
				for (const s of mpnStillReject.slice(0, 3)) console.log(`        ${s}`);
			}
			if (Object.keys(suspiciousIds).length > 0) {
				console.log(`    suspicious sample:`);
				for (const [id, info] of Object.entries(suspiciousIds).slice(0, 3)) {
					console.log(`        ${id}: ${info.reason}`);
				}
			}
		} catch (err) {
			console.log(`  ERROR: ${(err as Error).message}`);
		}
	}

	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
