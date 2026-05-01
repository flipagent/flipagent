/**
 * Per-tier monthly credit budget + burst rate limits.
 *
 * One unit, credits, covers every metered endpoint. Each call charges a
 * fixed number of credits depending on what it does — search/scrape reads
 * are 1 credit, evaluate is 50, discover is 250 (matching the COGS ratio
 * each implies). Cached responses cost 0 credits — those incur no
 * Oxylabs/LLM cost on our side.
 *
 * The pricing page advertises in credits; the dashboard renders the
 * usage gauge in credits; agents budget in credits. Same unit end to end.
 *
 * Burst limits (per-min, per-hour) are checked against raw call counts —
 * abuse protection, not pricing.
 *
 * Counts via `select sum(<credits CASE>)` against `usage_events`. The
 * row already records the endpoint string, so credit cost is derivable
 * without a schema migration. Add a `credits_charged` column when the
 * CASE expression starts showing up in slow-query logs.
 */

import { and, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys, creditGrants, usageEvents, user } from "../db/schema.js";
import type { Tier } from "./keys.js";

export interface TierLimits {
	/** Credit budget. For monthly tiers (paid), this resets on the 1st UTC. */
	credits: number;
	/**
	 * True for tiers whose budget is granted **once, lifetime** (Free). usage
	 * is summed across all events ever — no monthly window — and `resetAt`
	 * surfaces as null. False for paid tiers, where credits refill monthly.
	 */
	oneTime: boolean;
	/** Burst caps — abuse protection on raw call rate. */
	burstPerMin: number;
	burstPerHour: number;
}

/**
 * Source of truth for tier credit budgets. Pricing page and rate-limits
 * docs render their own copies for display; never let those drift from
 * what's enforced here.
 *
 * Free is intentionally lifetime, not monthly — the goal is "real trial,
 * upgrade when you outgrow it" rather than "small monthly stipend forever".
 */
export const TIER_LIMITS: Record<Tier, TierLimits> = {
	free: { credits: 500, oneTime: true, burstPerMin: 10, burstPerHour: 200 },
	hobby: { credits: 3_000, oneTime: false, burstPerMin: 30, burstPerHour: 1_200 },
	standard: { credits: 100_000, oneTime: false, burstPerMin: 120, burstPerHour: 6_000 },
	growth: { credits: 500_000, oneTime: false, burstPerMin: 600, burstPerHour: 25_000 },
};

/**
 * Credit cost per call, by endpoint. Mirrored on the pricing page —
 * any change here ships with copy updates there. Cache-hit short-circuits
 * to 0 (the middleware skips the usage_events insert in that case anyway,
 * so this is just a defensive lookup for any future code that calls this
 * directly).
 */
export function creditsForEndpoint(endpoint: string, fromCache = false): number {
	if (fromCache) return 0;
	if (endpoint.startsWith("/v1/evaluate")) return 50;
	if (endpoint.startsWith("/v1/discover")) return 250;
	if (endpoint.startsWith("/v1/browser")) return 5;
	// Everything else metered (search, marketplace mirror, ship, expenses, …)
	return 1;
}

export interface UsageSnapshot {
	creditsUsed: number;
	creditsLimit: number;
	creditsRemaining: number;
	overLimit: boolean;
	/**
	 * Sum of active (`revoked_at IS NULL` and unexpired) grants for the
	 * user, in credits. Already added to `creditsLimit`; surfaced
	 * separately so the dashboard can render a "+N admin bonus" hint.
	 * 0 when the caller has no active grants (or no userId scope).
	 */
	bonusCredits: number;
	/** ISO timestamp of the next refill, or null for lifetime (Free) tiers. */
	resetAt: string | null;
}

/**
 * Sum of active credit grants for `userId`. A grant is active when
 * `revoked_at IS NULL` AND (`expires_at IS NULL` OR `expires_at > now()`).
 * Both positive (bonus) and negative (clawback) grants are summed —
 * the result is the net adjustment to the tier credit budget.
 */
export async function sumActiveCreditGrants(userId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`cast(coalesce(sum(${creditGrants.creditsDelta}), 0) as int)` })
		.from(creditGrants)
		.where(
			and(
				eq(creditGrants.userId, userId),
				isNull(creditGrants.revokedAt),
				or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, sql`now()`)),
			),
		);
	return row?.total ?? 0;
}

function nextMonthBoundary(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * SQL CASE expression that converts a `usage_events.endpoint` row into
 * its credit cost. Kept in sync with `creditsForEndpoint()` above —
 * if you change one, change the other.
 */
const CREDITS_CASE = sql<number>`CASE
	WHEN ${usageEvents.endpoint} LIKE '/v1/evaluate%' THEN 50
	WHEN ${usageEvents.endpoint} LIKE '/v1/discover%' THEN 250
	WHEN ${usageEvents.endpoint} LIKE '/v1/browser%' THEN 5
	ELSE 1
END`;

/**
 * Resolve the credit-counting epoch — the timestamp from which usage
 * events start counting against the current tier's budget. For session/
 * keys-bound users we read `user.creditsResetAt` (set on signup, bumped
 * by the Stripe webhook on every tier transition). For legacy api-key-
 * only callers (no userId) we fall back to the key's own `createdAt`
 * so a self-hosted tester still gets sensible accounting. Falls back
 * to the unix epoch when no row resolves — preserves pre-migration
 * behaviour for orphan rows.
 */
async function resolveCreditsResetAt(scope: { apiKeyId: string; userId: string | null }): Promise<Date> {
	if (scope.userId) {
		const [row] = await db
			.select({ resetAt: user.creditsResetAt })
			.from(user)
			.where(eq(user.id, scope.userId))
			.limit(1);
		if (row?.resetAt) return row.resetAt;
	}
	if (scope.apiKeyId) {
		const [row] = await db
			.select({ createdAt: apiKeys.createdAt })
			.from(apiKeys)
			.where(eq(apiKeys.id, scope.apiKeyId))
			.limit(1);
		if (row?.createdAt) return row.createdAt;
	}
	return new Date(0);
}

/**
 * Credit usage snapshot. Aggregates across **all keys belonging to the
 * same user** when `userId` is provided — multiple named keys share one
 * budget. Falls back to per-key counting for legacy keys with no userId.
 *
 * Counting window depends on the tier:
 *   - Free (oneTime) → events from `user.creditsResetAt` onwards.
 *                       Bumped on every tier transition, so a Standard
 *                       user who downgrades gets a fresh 500-credit
 *                       window from the cancel timestamp instead of
 *                       inheriting their pre-downgrade usage.
 *   - Paid (monthly) → events from `max(creditsResetAt, monthStart)` —
 *                       monthly refill, but never count events from a
 *                       prior tier (a mid-month upgrade only counts
 *                       post-upgrade events against the new tier's cap).
 *
 * `creditsLimit` already folds in active credit_grants (positive bonus
 * or negative clawback); `bonusCredits` surfaces the same total
 * separately so dashboards can render "+N admin bonus" without
 * recomputing.
 */
export async function snapshotUsage(
	scope: { apiKeyId: string; userId: string | null },
	tier: Tier,
): Promise<UsageSnapshot> {
	const cfg = TIER_LIMITS[tier];
	const ownerFilter = scope.userId ? eq(usageEvents.userId, scope.userId) : eq(usageEvents.apiKeyId, scope.apiKeyId);

	// `floor` is the earliest createdAt we count. Free uses the bare epoch;
	// paid tiers take whichever is later between the tier-change epoch and
	// the start of the current calendar month — so a mid-month upgrade
	// doesn't sweep up the user's pre-upgrade Free events into the new
	// tier's monthly budget.
	const epoch = await resolveCreditsResetAt(scope);
	const now = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const floor = cfg.oneTime ? epoch : epoch > monthStart ? epoch : monthStart;

	const [usageRow, bonus] = await Promise.all([
		db
			.select({ credits: sql<number>`cast(coalesce(sum(${CREDITS_CASE}), 0) as int)` })
			.from(usageEvents)
			.where(and(ownerFilter, gte(usageEvents.createdAt, floor)))
			.then((rows) => rows[0]),
		scope.userId ? sumActiveCreditGrants(scope.userId) : Promise.resolve(0),
	]);
	const used = usageRow?.credits ?? 0;
	const limit = Math.max(0, cfg.credits + bonus);
	return {
		creditsUsed: used,
		creditsLimit: limit,
		creditsRemaining: Math.max(0, limit - used),
		overLimit: used >= limit,
		bonusCredits: bonus,
		resetAt: cfg.oneTime ? null : nextMonthBoundary().toISOString(),
	};
}

/**
 * Burst usage over a sliding window. Counts raw events (not credits) —
 * the goal is abuse protection, not pricing. A flood of cheap search
 * calls can still DOS the upstream just like a flood of expensive ones.
 */
export async function snapshotBurst(
	scope: { apiKeyId: string; userId: string | null },
	tier: Tier,
): Promise<{ perMinute: number; perHour: number; minuteOver: boolean; hourOver: boolean }> {
	const limits = TIER_LIMITS[tier];
	const filter = scope.userId ? eq(usageEvents.userId, scope.userId) : eq(usageEvents.apiKeyId, scope.apiKeyId);
	const [row] = await db
		.select({
			minute: sql<number>`cast(count(*) filter (where ${usageEvents.createdAt} >= now() - interval '1 minute') as int)`,
			hour: sql<number>`cast(count(*) filter (where ${usageEvents.createdAt} >= now() - interval '1 hour') as int)`,
		})
		.from(usageEvents)
		.where(and(filter, gte(usageEvents.createdAt, sql`now() - interval '1 hour'`)));
	const perMinute = row?.minute ?? 0;
	const perHour = row?.hour ?? 0;
	return {
		perMinute,
		perHour,
		minuteOver: perMinute >= limits.burstPerMin,
		hourOver: perHour >= limits.burstPerHour,
	};
}

/**
 * Shape an internal `UsageSnapshot` for the wire (`/v1/me`,
 * `/v1/keys/me`). Just JSON-safes the numeric fields; resetAt passes
 * through unchanged.
 */
export function usageToWire(snapshot: UsageSnapshot): {
	creditsUsed: number;
	creditsLimit: number;
	creditsRemaining: number;
	bonusCredits: number;
	resetAt: string | null;
} {
	return {
		creditsUsed: snapshot.creditsUsed,
		creditsLimit: snapshot.creditsLimit,
		creditsRemaining: snapshot.creditsRemaining,
		bonusCredits: snapshot.bonusCredits,
		resetAt: snapshot.resetAt,
	};
}

export async function recordUsage(input: {
	apiKeyId: string;
	userId: string | null;
	endpoint: string;
	statusCode: number;
	latencyMs: number;
}): Promise<void> {
	await db.insert(usageEvents).values(input);
}
