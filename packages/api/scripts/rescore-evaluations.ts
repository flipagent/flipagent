/**
 * Re-score every completed evaluate job against the current quant model
 * WITHOUT touching any upstream (no scrape, no LLM, no detail fetch).
 *
 * Reads `compute_jobs WHERE kind='evaluate' AND status='completed' AND result IS NOT NULL`,
 * reconstructs the digest from `result.{item, soldPool, activePool}`, then
 * rebuilds `evaluation`, `market`, `sold`, `active` from scratch via the
 * current pure-function pipeline (`evaluate`, `marketFromSold`,
 * `buildSoldDigest`, `buildActiveDigest`). Preserves `meta`, `filter`,
 * `returns`, pools, and item snapshot.
 *
 * Idempotent — safe to re-run after another quant change.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/rescore-evaluations.ts
 *   DRY_RUN=1 node --env-file=.env --import tsx scripts/rescore-evaluations.ts
 *   BATCH=200 node --env-file=.env --import tsx scripts/rescore-evaluations.ts
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { computeJobs } from "../src/db/schema.js";
import { marketFromSold } from "../src/services/evaluate/adapter.js";
import { buildActiveDigest, buildSoldDigest } from "../src/services/evaluate/digest.js";
import { evaluate } from "../src/services/evaluate/evaluate.js";
import type { EvaluableItem, EvaluateOptions } from "../src/services/evaluate/types.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH = Number.parseInt(process.env.BATCH ?? "500", 10);

type EvalParams = {
	itemId?: string;
	opts?: EvaluateOptions;
};

type EvalResult = {
	item?: unknown;
	evaluation?: unknown;
	soldPool?: unknown[];
	activePool?: unknown[];
	[key: string]: unknown;
};

async function main(): Promise<void> {
	const t0 = performance.now();
	let offset = 0;
	let total = 0;
	let updated = 0;
	let skippedNoItem = 0;
	let failed = 0;

	console.log(`[rescore] mode=${DRY_RUN ? "DRY_RUN" : "WRITE"} batch=${BATCH}`);

	while (true) {
		const rows = await db
			.select({ id: computeJobs.id, params: computeJobs.params, result: computeJobs.result })
			.from(computeJobs)
			.where(
				and(
					eq(computeJobs.kind, "evaluate"),
					eq(computeJobs.status, "completed"),
					isNotNull(computeJobs.result),
				),
			)
			.orderBy(computeJobs.createdAt)
			.limit(BATCH)
			.offset(offset);

		if (rows.length === 0) break;

		for (const row of rows) {
			total++;
			const params = (row.params ?? {}) as EvalParams;
			const result = (row.result ?? {}) as EvalResult;

			const item = result.item;
			if (!item || typeof item !== "object") {
				skippedNoItem++;
				continue;
			}

			const sold = Array.isArray(result.soldPool) ? result.soldPool : [];
			const active = Array.isArray(result.activePool) ? result.activePool : [];

			try {
				const soldPool = sold as ReadonlyArray<ItemSummary>;
				const activePool = active as ReadonlyArray<ItemSummary>;
				const opts: EvaluateOptions = {
					...(params.opts ?? {}),
					sold: soldPool,
					asks: activePool,
				};
				const newEvaluation = evaluate(item as EvaluableItem, opts);
				const newMarket = marketFromSold(soldPool, undefined, undefined, activePool);
				const newSold = buildSoldDigest(
					soldPool,
					(newMarket as { windowDays: number }).windowDays,
					(newMarket as { salesPerDay: number }).salesPerDay,
					(newMarket as { meanDaysToSell: number | null }).meanDaysToSell ?? null,
				);
				const newActive = buildActiveDigest(activePool);

				if (DRY_RUN) {
					updated++;
					continue;
				}

				const nextResult = {
					...result,
					evaluation: newEvaluation,
					market: newMarket,
					sold: newSold,
					active: newActive,
				};
				await db
					.update(computeJobs)
					.set({ result: nextResult, updatedAt: sql`now()` })
					.where(eq(computeJobs.id, row.id));
				updated++;
			} catch (err) {
				failed++;
				console.error(`[rescore] job=${row.id} item=${params.itemId ?? "?"} failed: ${(err as Error).message}`);
			}
		}

		offset += rows.length;
		const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
		console.log(
			`[rescore] processed=${total} updated=${updated} skippedNoItem=${skippedNoItem} failed=${failed} elapsed=${elapsed}s`,
		);
		if (rows.length < BATCH) break;
	}

	console.log("");
	console.log(`[rescore] done — total=${total} updated=${updated} failed=${failed}`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
