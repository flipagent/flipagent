/**
 * Per-pair match-decision cache. The two-pass LLM matcher pays for one
 * inference per (candidate, item) pair on every Discover / Evaluate
 * call — many of those pairs are seen repeatedly across users (the same
 * Travis Scott Mocha listings get scanned by every sneaker hunter for
 * weeks). This cache short-circuits the second pass: if the same pair
 * was decided in the last 30 days, return that decision directly.
 *
 * TTL 30d because eBay listings expire and seller framing shifts over
 * time. Older decisions go stale and are re-evaluated when next seen.
 *
 * Always on. The cache holds *decisions* (binary same-product outcomes)
 * — pure performance optimisation, not telemetry. The separate
 * `OBSERVATION_ENABLED` flag gates the listing-content archive
 * (`listing_observations` table), which IS a hosted telemetry feature.
 * Mixing the two gates meant self-host always paid full LLM cost on
 * repeat pairs; that's no longer the case.
 */

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { matchDecisions } from "../../db/schema.js";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CachedDecision = "match" | "reject";

export async function getCachedMatchDecision(
	candidateId: string,
	itemId: string,
): Promise<{ decision: CachedDecision; reason: string } | null> {
	const [row] = await db
		.select({ decision: matchDecisions.decision, reason: matchDecisions.reason })
		.from(matchDecisions)
		.where(
			and(
				eq(matchDecisions.candidateId, candidateId),
				eq(matchDecisions.itemId, itemId),
				gt(matchDecisions.expiresAt, sql`now()`),
			),
		)
		.limit(1);
	if (!row) return null;
	if (row.decision !== "match" && row.decision !== "reject") return null;
	return { decision: row.decision, reason: row.reason ?? "" };
}

export async function setCachedMatchDecision(
	candidateId: string,
	itemId: string,
	decision: CachedDecision,
	reason: string,
): Promise<void> {
	const expiresAt = new Date(Date.now() + TTL_MS);
	try {
		await db
			.insert(matchDecisions)
			.values({ candidateId, itemId, decision, reason: reason.slice(0, 1000), expiresAt })
			.onConflictDoUpdate({
				target: [matchDecisions.candidateId, matchDecisions.itemId],
				set: {
					decision,
					reason: reason.slice(0, 1000),
					decidedAt: sql`now()`,
					expiresAt,
				},
			});
	} catch (err) {
		console.error("[match-cache] write failed:", err);
	}
}
