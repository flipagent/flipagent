/**
 * Run /v1/evaluate locally with full per-stage instrumentation.
 *
 * Goals:
 *   1. Confirm where wall time goes (detail / sold-search / active-search /
 *      filter / evaluate, plus matcher sub-stages).
 *   2. Snapshot the seed + raw sold + raw active pool so the model bake-off
 *      can replay matchPool against the SAME inputs across every model
 *      without re-paying scrape cost.
 *
 *   ITEM_ID=v1|<legacy>|<var?> APIKEY_ID=<uuid> \
 *     node --env-file=.env --import tsx scripts/evaluate-trace.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema.js";
import type { ApiKey } from "../src/db/schema.js";
import { runEvaluatePipeline } from "../src/services/evaluate/run.js";
import type { StepEvent } from "../src/services/evaluate/run.js";

const ITEM_ID = process.env.ITEM_ID;
const APIKEY_ID = process.env.APIKEY_ID;
const OUT_DIR = process.env.OUT_DIR ?? "scripts/.bench-out";

if (!ITEM_ID) {
	console.error("ITEM_ID required (e.g. ITEM_ID=v1|123456789012|0)");
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

async function main(): Promise<void> {
	let apiKey: ApiKey | undefined;
	if (APIKEY_ID) {
		const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
		apiKey = rows[0];
		if (!apiKey) throw new Error(`api_key ${APIKEY_ID} not found`);
		console.log(`[bench] api_key tier=${apiKey.tier} id=${apiKey.id}`);
	}

	const events: StepEvent[] = [];
	const onStep = (e: StepEvent): void => {
		events.push(e);
		if (e.kind === "started") {
			console.log(`  → ${e.key.padEnd(20)} start`);
		} else if (e.kind === "succeeded") {
			console.log(`  ✓ ${e.key.padEnd(20)} ${String(e.durationMs).padStart(6)}ms`);
		} else {
			console.log(`  ✗ ${e.key.padEnd(20)} ${String(e.durationMs).padStart(6)}ms  ${e.error}`);
		}
	};

	console.log(`[bench] item=${ITEM_ID} provider=${process.env.LLM_PROVIDER ?? "auto"}`);
	const t0 = performance.now();
	const result = await runEvaluatePipeline({
		itemId: ITEM_ID!,
		apiKey,
		onStep,
	});
	const totalMs = Math.round(performance.now() - t0);
	console.log(`[bench] TOTAL ${totalMs}ms`);

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const snapshot = {
		stamp,
		itemId: ITEM_ID,
		llmProvider: process.env.LLM_PROVIDER ?? null,
		llmModel: process.env.GOOGLE_MODEL ?? process.env.ANTHROPIC_MODEL ?? process.env.OPENAI_MODEL ?? null,
		totalMs,
		events,
		seed: result.item,
		// Pre-LLM-filter pools — matched + rejected. Replay can re-deduplicate.
		soldPoolMatched: result.soldPool,
		soldPoolRejected: result.rejectedSoldPool,
		activePoolMatched: result.activePool,
		activePoolRejected: result.rejectedActivePool,
		rejectionReasons: result.rejectionReasons,
		evaluation: result.evaluation,
		market: result.market,
	};
	const path = `${OUT_DIR}/trace-${stamp}.json`;
	writeFileSync(path, JSON.stringify(snapshot, null, 2));
	console.log(`[bench] snapshot → ${path}`);

	const breakdown = events
		.filter((e) => e.kind === "succeeded" || e.kind === "failed")
		.map((e) => ({ key: e.key, ms: (e as { durationMs: number }).durationMs }));
	console.log("\n[bench] breakdown:");
	for (const b of breakdown) console.log(`  ${b.key.padEnd(20)} ${String(b.ms).padStart(6)}ms`);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("[bench] fatal:", err);
		process.exit(1);
	});
