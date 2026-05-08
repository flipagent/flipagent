/**
 * Platform-wide "Try one" showcase. Reads recent successful evaluate
 * jobs across all callers and surfaces the top N by recency, deduped
 * by itemId, with takedown'd itemIds filtered out.
 *
 * Why: the playground's hardcoded preset itemIds rot — listings sell,
 * get delisted, lose sold-pool depth — and a stale demo click is the
 * worst first impression. Sourcing presets from real recent runs
 * means the showcase is always live, and clicking through hits a
 * cached evaluate result (no new credits burned).
 *
 * ToS: every row carries `itemWebUrl` so click-through points at
 * `ebay.com/itm/...`. Approved takedowns excluded via NOT IN sub-query.
 */

import type { EvaluateResponse, FeaturedEvaluation } from "@flipagent/types";
import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { computeJobs, takedownRequests } from "../../db/schema.js";

/** How far back we look when picking showcase rows. Older runs go stale fast. */
const LOOKBACK_DAYS = 14;

/**
 * Minimum sold-pool depth for a job to qualify. Below this the
 * evaluation's market stats are too thin to be a useful demo. Matches
 * the threshold the evaluate pipeline itself uses to bail with
 * `too_few_matches`.
 */
const MIN_SOLD_POOL = 8;

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;

export async function listFeaturedEvaluations(opts: { limit?: number } = {}): Promise<FeaturedEvaluation[]> {
	const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
	const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);

	// Pull a generous window — we'll dedupe by itemId after the fact and
	// trim to `limit`. Over-fetch by ~5x so dedup loss doesn't starve
	// the response when the same hot itemId was evaluated repeatedly.
	const rows = await db
		.select({
			result: computeJobs.result,
			completedAt: computeJobs.completedAt,
		})
		.from(computeJobs)
		.where(
			and(
				eq(computeJobs.kind, "evaluate"),
				eq(computeJobs.status, "completed"),
				gte(computeJobs.completedAt, since),
				notInArray(
					sql`(${computeJobs.params}->>'itemId')`,
					db
						.select({ itemId: takedownRequests.itemId })
						.from(takedownRequests)
						.where(eq(takedownRequests.status, "approved")),
				),
				// Sold-pool length filter — JSONB `jsonb_array_length` returns
				// NULL when the path doesn't exist, so we coalesce to 0.
				sql`COALESCE(jsonb_array_length(${computeJobs.result}->'soldPool'), 0) >= ${MIN_SOLD_POOL}`,
			),
		)
		.orderBy(desc(computeJobs.completedAt))
		.limit(limit * 5);

	const seen = new Set<string>();
	const out: FeaturedEvaluation[] = [];
	for (const row of rows) {
		if (out.length >= limit) break;
		const result = row.result as EvaluateResponse | null;
		const anchor = result?.anchor;
		const itemId = anchor?.itemId;
		const title = anchor?.title;
		const itemWebUrl = anchor?.itemWebUrl;
		const completedAt = row.completedAt;
		if (!itemId || !title || !itemWebUrl || !completedAt) continue;
		if (seen.has(itemId)) continue;
		seen.add(itemId);
		const image = pickImage(anchor);
		out.push({
			itemId,
			title,
			itemWebUrl,
			...(image ? { image } : {}),
			completedAt: completedAt.toISOString(),
		});
	}
	return out;
}

function pickImage(anchor: NonNullable<EvaluateResponse["anchor"]> | undefined): string | undefined {
	if (!anchor) return undefined;
	if (anchor.image?.imageUrl) return anchor.image.imageUrl;
	return anchor.additionalImages?.[0]?.imageUrl;
}
