/**
 * Anonymized query-frequency tracker. Each search request bumps the
 * counter for `(hourBucket, categoryId, queryHash)` so we accumulate a
 * cross-user pulse signal without storing the raw keyword strings or
 * which user issued which query.
 *
 * `queryHash` is a stable hash of the normalised keyword set —
 * deterministic across users, irreversible (no rainbow-table risk
 * because the hash space is enormous and we don't expose it). Cross-user
 * frequency is the only thing we read out of this table; trending
 * surfaces compare current-hour count vs prior-week baseline per
 * category to flag heating segments.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { queryPulse } from "../../db/schema.js";

export interface TrendingCategory {
	categoryId: string;
	currentHourCount: number;
	weeklyBaselineHourly: number;
	zScore: number;
	asOf: string;
}

/**
 * Bump query_pulse for one search call. Fire-and-forget; never throws
 * back into the request flow. Off when `OBSERVATION_ENABLED=0`.
 */
export async function recordQueryPulse(args: { keyword?: string; categoryId?: string }): Promise<void> {
	if (!config.OBSERVATION_ENABLED) return;
	const hourBucket = floorToHour(new Date());
	const categoryId = args.categoryId ?? "";
	const queryHash = hashKeyword(args.keyword ?? "");
	try {
		await db
			.insert(queryPulse)
			.values({ hourBucket, categoryId, queryHash, queryCount: 1 })
			.onConflictDoUpdate({
				target: [queryPulse.hourBucket, queryPulse.categoryId, queryPulse.queryHash],
				set: { queryCount: sql`${queryPulse.queryCount} + 1` },
			});
	} catch (err) {
		console.error("[trends] pulse insert failed:", err);
	}
}

/**
 * Top trending categories — those whose current-hour query count is
 * highest above their prior-7-day hourly baseline (Poisson-style z).
 * Returns at most `limit` rows.
 */
export async function topTrendingCategories(limit = 10): Promise<TrendingCategory[]> {
	const now = new Date();
	const currentHour = floorToHour(now);
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	// Current-hour totals per category.
	const currentRows = await db
		.select({
			categoryId: queryPulse.categoryId,
			count: sql<number>`sum(${queryPulse.queryCount})::int`,
		})
		.from(queryPulse)
		.where(eq(queryPulse.hourBucket, currentHour))
		.groupBy(queryPulse.categoryId);

	// Past-7-day per-hour baseline per category (mean over 168 hours).
	const baselineRows = await db
		.select({
			categoryId: queryPulse.categoryId,
			total: sql<number>`sum(${queryPulse.queryCount})::int`,
		})
		.from(queryPulse)
		.where(and(gte(queryPulse.hourBucket, weekAgo), lt(queryPulse.hourBucket, currentHour)))
		.groupBy(queryPulse.categoryId);
	const baselineByCat = new Map<string, number>();
	for (const r of baselineRows) baselineByCat.set(r.categoryId, r.total / 168);

	const results: TrendingCategory[] = [];
	for (const r of currentRows) {
		if (!r.categoryId) continue; // skip the unbucketed pseudo-row
		const baseline = baselineByCat.get(r.categoryId) ?? 0;
		// Poisson z-score: (observed − expected) / sqrt(expected). When
		// baseline=0 we can't z-score; treat anything > 0 as a fresh signal.
		const z = baseline > 0 ? (r.count - baseline) / Math.sqrt(baseline) : r.count;
		results.push({
			categoryId: r.categoryId,
			currentHourCount: r.count,
			weeklyBaselineHourly: Number(baseline.toFixed(2)),
			zScore: Number(z.toFixed(2)),
			asOf: currentHour.toISOString(),
		});
	}
	results.sort((a, b) => b.zScore - a.zScore);
	return results.slice(0, limit);
}

function hashKeyword(raw: string): string {
	const normalised = raw.trim().toLowerCase().replace(/\s+/g, " ").split(" ").sort().join(" ");
	if (!normalised) return "";
	return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

function floorToHour(d: Date): Date {
	const out = new Date(d);
	out.setMinutes(0, 0, 0);
	return out;
}

// Re-exports drizzle helpers so callers don't need their own imports.
export { desc };
