/**
 * Re-score every completed evaluate job against the current quant model
 * (no upstream calls). Prints a per-item diff (rating, P_fraud, expectedNet)
 * and summary counts. No DB writes — diagnostic only.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/rescore-diff.ts
 *   FILTER=287302548160 node --env-file=.env --import tsx scripts/rescore-diff.ts
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { computeJobs } from "../src/db/schema.js";
import { evaluate } from "../src/services/evaluate/evaluate.js";
import type { EvaluableItem, EvaluateOptions } from "../src/services/evaluate/types.js";

const FILTER = process.env.FILTER ?? "";

type EvalParams = { itemId?: string; opts?: EvaluateOptions };
type EvalResult = {
	item?: unknown;
	soldPool?: unknown[];
	activePool?: unknown[];
	evaluation?: {
		rating?: string;
		risk?: { P_fraud: number };
		successNetCents?: number | null;
		expectedNetCents?: number;
		maxLossCents?: number | null;
	};
};

const $ = (c: number | null | undefined) => (c == null ? "—".padStart(5) : `$${(c / 100).toFixed(0)}`.padStart(5));
const pct = (p: number | undefined) => (p == null ? "—".padStart(6) : `${(p * 100).toFixed(1)}%`.padStart(6));

async function main(): Promise<void> {
	const rows = await db
		.select({ id: computeJobs.id, params: computeJobs.params, result: computeJobs.result, createdAt: computeJobs.createdAt })
		.from(computeJobs)
		.where(and(eq(computeJobs.kind, "evaluate"), eq(computeJobs.status, "completed"), isNotNull(computeJobs.result)))
		.orderBy(desc(computeJobs.createdAt));

	const seen = new Set<string>();
	type Row = {
		itemId: string;
		title: string;
		buy: number;
		oldRating: string;
		newRating: string;
		oldP: number;
		newP: number;
		oldExp: number | null | undefined;
		newExp: number;
		flipped: boolean;
	};
	const out: Row[] = [];

	for (const row of rows) {
		const params = (row.params ?? {}) as EvalParams;
		const result = (row.result ?? {}) as EvalResult;
		const item = result.item as EvaluableItem | undefined;
		if (!item || typeof item !== "object") continue;
		const itemId = (item as { itemId?: string }).itemId ?? "";
		if (seen.has(itemId)) continue; // most recent only
		seen.add(itemId);
		if (FILTER && !itemId.includes(FILTER)) continue;

		const sold = (result.soldPool ?? []) as ReadonlyArray<ItemSummary>;
		const active = (result.activePool ?? []) as ReadonlyArray<ItemSummary>;
		const opts: EvaluateOptions = { ...(params.opts ?? {}), sold, asks: active };
		try {
			const after = evaluate(item, opts);
			const before = result.evaluation;
			const oldRating = before?.rating ?? "—";
			const newRating = after.rating;
			const oldP = before?.risk?.P_fraud ?? 0;
			const newP = after.risk?.P_fraud ?? 0;
			const oldExp = before?.expectedNetCents;
			const newExp = after.expectedNetCents;
			const flipped = oldRating !== newRating;

			out.push({
				itemId,
				title: ((item as { title?: string }).title ?? "").slice(0, 50),
				buy: Number.parseFloat(((item as { price?: { value?: string } }).price?.value ?? "0")),
				oldRating,
				newRating,
				oldP,
				newP,
				oldExp,
				newExp,
				flipped,
			});
		} catch (err) {
			console.error(`[skip] ${itemId}: ${(err as Error).message}`);
		}
	}

	// Sort: flipped first, then by largest |ΔP_fraud|
	out.sort((a, b) => {
		if (a.flipped !== b.flipped) return a.flipped ? -1 : 1;
		return Math.abs(b.newP - b.oldP) - Math.abs(a.newP - a.oldP);
	});

	console.log("");
	console.log(`item            buy       title                                              old→new          P_fraud         expNet`);
	console.log(`────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────`);
	for (const r of out) {
		const flag = r.flipped ? "★" : " ";
		const ratingPart = `${r.oldRating}→${r.newRating}`.padEnd(10);
		console.log(
			`${flag} ${r.itemId.padEnd(15)} $${r.buy.toFixed(0).padStart(6)}  ${r.title.padEnd(50)}  ${ratingPart}  ${pct(r.oldP)}→${pct(r.newP)}  ${$(r.oldExp)}→${$(r.newExp)}`,
		);
	}

	const flipped = out.filter((r) => r.flipped);
	const buyToSkip = flipped.filter((r) => r.oldRating === "buy" && r.newRating === "skip");
	const skipToBuy = flipped.filter((r) => r.oldRating === "skip" && r.newRating === "buy");
	console.log("");
	console.log(`total: ${out.length} | unchanged: ${out.length - flipped.length} | flipped: ${flipped.length} (buy→skip ${buyToSkip.length}, skip→buy ${skipToBuy.length})`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
