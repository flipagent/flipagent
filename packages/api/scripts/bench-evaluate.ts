/**
 * Benchmark `runEvaluatePipeline` end-to-end wall time. Calls the same
 * function the HTTP `POST /v1/evaluate` route invokes, so cache layers,
 * transport dispatch, matcher, and scoring all participate honestly.
 *
 * For each seed:
 *   - cold: cache flushed, fresh scrape + matcher
 *   - warm: cache hit on detail + search + match-decisions
 *
 * Usage:
 *   SEEDS=v1|187760409559|0,v1|198318875666|0 \
 *     node --env-file=.env --import tsx scripts/bench-evaluate.ts
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys, proxyResponseCache } from "../src/db/schema.js";
import { runEvaluatePipeline } from "../src/services/evaluate/run.js";

const SEEDS = (process.env.SEEDS ?? "v1|187760409559|0,v1|198318875666|0").split(",").filter(Boolean);
const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";
const REPS = Number.parseInt(process.env.REPS ?? "1", 10);

async function flushAll(legacyId: string): Promise<void> {
	await db.delete(proxyResponseCache);
	await db.execute(sql`delete from match_decisions where candidate_id = ${`v1|${legacyId}|0`}`).catch(() => undefined);
}

async function timed(itemId: string, apiKey: typeof apiKeys.$inferSelect): Promise<{ wallMs: number; soldKept?: number; soldRejected?: number; activeKept?: number }> {
	const t0 = performance.now();
	try {
		const r = await runEvaluatePipeline({ itemId, apiKey });
		return {
			wallMs: Math.round(performance.now() - t0),
			soldKept: r.meta?.soldKept,
			soldRejected: r.meta?.soldRejected,
			activeKept: r.meta?.activeKept,
		};
	} catch (err) {
		const wallMs = Math.round(performance.now() - t0);
		console.log(`  ! error after ${wallMs}ms: ${(err as Error).message}`);
		return { wallMs };
	}
}

async function main(): Promise<void> {
	const apiKey = (await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID)))[0];
	if (!apiKey) throw new Error(`apiKey ${APIKEY_ID} not found`);

	console.log(`[bench] seeds: ${SEEDS.length} | reps per cold/warm: ${REPS}`);
	console.log(`[bench] config: VERIFY_CHUNK=${process.env.VERIFY_CHUNK ?? "1 (default)"}  LLM_MAX_CONCURRENT=${process.env.LLM_MAX_CONCURRENT ?? "16 (default)"}`);
	console.log("");

	const stats: { seed: string; cold: number; warm: number; soldKept?: number }[] = [];
	for (const itemId of SEEDS) {
		const m = /^v1\|(\d+)\|/.exec(itemId);
		const legacyId = m?.[1] ?? itemId;
		console.log(`════════════════════════════════════════════════════════════════════════════════`);
		console.log(`seed: ${itemId}`);

		const coldTimes: number[] = [];
		let lastSoldKept: number | undefined;
		for (let i = 0; i < REPS; i++) {
			await flushAll(legacyId);
			const r = await timed(itemId, apiKey);
			coldTimes.push(r.wallMs);
			lastSoldKept = r.soldKept;
			console.log(`  cold rep${i + 1}:  ${r.wallMs}ms   soldKept=${r.soldKept ?? "?"} rejected=${r.soldRejected ?? "?"} active=${r.activeKept ?? "?"}`);
		}

		const warmTimes: number[] = [];
		for (let i = 0; i < REPS; i++) {
			const r = await timed(itemId, apiKey);
			warmTimes.push(r.wallMs);
			console.log(`  warm rep${i + 1}:  ${r.wallMs}ms`);
		}

		const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
		const cold = mean(coldTimes);
		const warm = mean(warmTimes);
		console.log(`  ────────────────────────────────────────────────────`);
		console.log(`  cold mean: ${cold}ms      warm mean: ${warm}ms      (${Math.round((1 - warm / cold) * 100)}% faster warm)`);
		console.log("");
		stats.push({ seed: itemId, cold, warm, soldKept: lastSoldKept });
	}

	console.log("════════════════════════════════════════════════════════════════════════════════");
	console.log("SUMMARY");
	console.log("════════════════════════════════════════════════════════════════════════════════");
	console.log(`seed                                 cold     warm    soldKept`);
	for (const s of stats) {
		console.log(`${s.seed.padEnd(36)} ${String(s.cold).padStart(5)}ms ${String(s.warm).padStart(5)}ms   ${s.soldKept ?? "?"}`);
	}
	const avgCold = Math.round(stats.reduce((a, s) => a + s.cold, 0) / stats.length);
	const avgWarm = Math.round(stats.reduce((a, s) => a + s.warm, 0) / stats.length);
	console.log(`${"AVG".padEnd(36)} ${String(avgCold).padStart(5)}ms ${String(avgWarm).padStart(5)}ms`);
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
