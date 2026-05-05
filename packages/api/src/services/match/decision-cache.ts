/**
 * Two-table matcher persistence:
 *
 *   1. `match_decisions` — runtime CACHE. (candidate, item) unique;
 *      latest decision wins (`onConflictDoUpdate`). 30d TTL. The
 *      two-pass LLM matcher reads this to skip repeat verifications:
 *      same Travis Scott Mocha listings get scanned by every sneaker
 *      hunter for weeks; one row, one bill.
 *
 *   2. `match_history` — APPEND-ONLY ML ARCHIVE. Every decision lands
 *      here as a new row, carrying `model_id` (`${provider}/${model}`)
 *      and the rejection `category`. Lets us A/B a new matcher against
 *      the historical seed→candidate corpus without re-running LLMs;
 *      pair with `listing_observations` (looked up by legacy id +
 *      nearest `observed_at`) to reconstruct what the matcher saw at
 *      decision time.
 *
 * Both writes share the same call site (`setCachedMatchDecision`) so
 * the matcher stays unaware of the split — it just declares "decision
 * X for pair Y by model M" and persistence does the right thing.
 *
 * TTL 30d on the cache reflects listing expiration and seller framing
 * drift; the archive has no TTL — ML iteration needs the full history.
 *
 * `OBSERVATION_ENABLED` gates the listing/product *content* archive
 * (separate concern, hosted telemetry). The matcher cache + history
 * are always on: cache is pure perf, history is per-pair decisions
 * (no listing content).
 */

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { matchDecisions, matchHistory } from "../../db/schema.js";

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

export interface SetMatchDecisionInput {
	candidateId: string;
	itemId: string;
	decision: CachedDecision;
	reason: string;
	/** Rejection bucket the verifier picked (for rejects). `undefined` for matches. */
	category?: string;
	/** `${provider.name}/${provider.model}` so cross-model evals are direct in the archive. */
	modelId?: string;
}

export async function setCachedMatchDecision(input: SetMatchDecisionInput): Promise<void> {
	const { candidateId, itemId, decision, reason, category, modelId } = input;
	const trimmedReason = reason.slice(0, 1000);
	const expiresAt = new Date(Date.now() + TTL_MS);
	// Cache write — latest decision wins.
	try {
		await db
			.insert(matchDecisions)
			.values({ candidateId, itemId, decision, reason: trimmedReason, expiresAt })
			.onConflictDoUpdate({
				target: [matchDecisions.candidateId, matchDecisions.itemId],
				set: {
					decision,
					reason: trimmedReason,
					decidedAt: sql`now()`,
					expiresAt,
				},
			});
	} catch (err) {
		console.error("[match-cache] cache write failed:", err);
	}
	// Archive write — append-only, never overwrites. Independent failure
	// path so a cache hit + archive miss (or vice versa) doesn't poison
	// the other.
	try {
		await db.insert(matchHistory).values({
			candidateId,
			itemId,
			decision,
			reason: trimmedReason,
			category: category ?? null,
			modelId: modelId ?? null,
		});
	} catch (err) {
		console.error("[match-cache] archive write failed:", err);
	}
}
