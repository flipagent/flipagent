/**
 * One-shot: rescore a single completed evaluate job (by job id) using
 * current quant code, print BEFORE / AFTER snapshot side by side.
 * No writes.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { computeJobs } from "../src/db/schema.js";
import { evaluate } from "../src/services/evaluate/evaluate.js";
import type { EvaluableItem, EvaluateOptions } from "../src/services/evaluate/types.js";

const JOB_ID = process.argv[2] ?? "607e12b3-e6fa-4afa-9ec3-ce395c888a2c";

type R = {
	item?: unknown;
	market?: { medianCents?: number; meanCents?: number; stdDevCents?: number; nObservations?: number };
	soldPool?: unknown[];
	activePool?: unknown[];
	evaluation?: {
		risk?: { P_fraud: number; reason: string; cycleDays: number };
		rating?: string;
		reason?: string;
		successNetCents?: number | null;
		expectedNetCents?: number;
		maxLossCents?: number | null;
		bidCeilingCents?: number | null;
	};
};

async function main(): Promise<void> {
	const [row] = await db.select().from(computeJobs).where(eq(computeJobs.id, JOB_ID));
	if (!row) throw new Error(`job ${JOB_ID} not found`);
	const params = (row.params ?? {}) as { opts?: EvaluateOptions };
	const result = (row.result ?? {}) as R;

	const item = result.item as EvaluableItem;
	const sold = (result.soldPool ?? []) as ReadonlyArray<ItemSummary>;
	const active = (result.activePool ?? []) as ReadonlyArray<ItemSummary>;
	const opts: EvaluateOptions = { ...(params.opts ?? {}), sold, asks: active };

	const before = result.evaluation;
	const after = evaluate(item, opts);

	const $ = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(0)}`);
	const pct = (p: number | undefined) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);

	const buy = (item as { price?: { value?: string } }).price?.value;
	const median = result.market?.medianCents;
	const stdDev = result.market?.stdDevCents;
	const ratio = median && buy ? (Number.parseFloat(buy) * 100) / median : null;

	console.log(`Item:     ${(item as { itemId: string }).itemId}`);
	console.log(`Buy:      $${buy}`);
	console.log(`Market:   median ${$(median)}, std ${$(stdDev)}, n=${result.market?.nObservations}`);
	console.log(`r:        ${ratio?.toFixed(3)}`);
	console.log("");
	console.log(`                       BEFORE       AFTER`);
	console.log(`P_fraud              ${pct(before?.risk?.P_fraud).padStart(7)}     ${pct(after.risk?.P_fraud).padStart(7)}`);
	console.log(`successNet           ${$(before?.successNetCents).padStart(7)}     ${$(after.successNetCents).padStart(7)}`);
	console.log(`maxLoss              ${$(before?.maxLossCents).padStart(7)}     ${$(after.maxLossCents).padStart(7)}`);
	console.log(`expectedNet          ${$(before?.expectedNetCents).padStart(7)}     ${$(after.expectedNetCents).padStart(7)}`);
	console.log(`bidCeiling           ${$(before?.bidCeilingCents).padStart(7)}     ${$(after.bidCeilingCents).padStart(7)}`);
	console.log(`rating               ${(before?.rating ?? "—").padStart(7)}     ${after.rating.padStart(7)}`);
	console.log("");
	console.log(`reason BEFORE: ${before?.reason}`);
	console.log(`reason AFTER:  ${after.reason}`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
