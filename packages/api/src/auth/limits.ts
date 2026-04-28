/**
 * Per-tier rate limits + monthly usage counter. Production scaling will
 * eventually need a faster counter (Redis, or a per-key monthly aggregate
 * row). PR #6 does the straight `select count(*)` against usage_events —
 * fine up to thousands of calls per key per month.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { usageEvents } from "../db/schema.js";
import type { Tier } from "./keys.js";

export interface TierLimits {
	perMonth: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
	free: { perMonth: 100 },
	hobby: { perMonth: 5_000 },
	pro: { perMonth: 50_000 },
	business: { perMonth: Number.POSITIVE_INFINITY },
};

export interface UsageSnapshot {
	used: number;
	limit: number;
	remaining: number;
	resetAt: string;
	overLimit: boolean;
}

function nextMonthBoundary(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Per-month usage. Aggregates across **all keys belonging to the same user**
 * when `userId` is provided — so multiple named keys share one quota.
 * Falls back to per-key counting for legacy keys with no userId.
 */
export async function snapshotUsage(
	scope: { apiKeyId: string; userId: string | null },
	tier: Tier,
): Promise<UsageSnapshot> {
	const limit = TIER_LIMITS[tier].perMonth;
	if (!Number.isFinite(limit)) {
		return {
			used: 0,
			limit: Number.POSITIVE_INFINITY,
			remaining: Number.POSITIVE_INFINITY,
			resetAt: nextMonthBoundary().toISOString(),
			overLimit: false,
		};
	}
	const filter = scope.userId ? eq(usageEvents.userId, scope.userId) : eq(usageEvents.apiKeyId, scope.apiKeyId);
	const [row] = await db
		.select({ count: sql<number>`cast(count(*) as int)` })
		.from(usageEvents)
		.where(and(filter, gte(usageEvents.createdAt, sql`date_trunc('month', now())`)));
	const used = row?.count ?? 0;
	return {
		used,
		limit,
		remaining: Math.max(0, limit - used),
		resetAt: nextMonthBoundary().toISOString(),
		overLimit: used >= limit,
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
