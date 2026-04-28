/**
 * Postgres-backed response cache for the eBay-compat proxy. Hard TTL
 * keeps cached entries fresh enough that they're not "redistribution" but
 * "anti-thundering-herd" — typical 60 minutes for active searches, longer
 * for item detail.
 */

import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { proxyResponseCache } from "../db/schema.js";

export const DEFAULT_TTL_SEC = 60 * 60;

export function hashQuery(params: Record<string, unknown>): string {
	const sorted = Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.sort(([a], [b]) => a.localeCompare(b));
	const canonical = JSON.stringify(sorted);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export interface CacheHit<T> {
	body: T;
	source: string;
	createdAt: Date;
}

export async function getCached<T>(path: string, queryHash: string): Promise<CacheHit<T> | null> {
	const rows = await db
		.select()
		.from(proxyResponseCache)
		.where(
			and(
				eq(proxyResponseCache.path, path),
				eq(proxyResponseCache.queryHash, queryHash),
				gt(proxyResponseCache.expiresAt, new Date()),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return { body: row.body as T, source: row.source, createdAt: row.createdAt };
}

export async function setCached(
	path: string,
	queryHash: string,
	body: unknown,
	source: string,
	ttlSec = DEFAULT_TTL_SEC,
): Promise<void> {
	const expiresAt = new Date(Date.now() + ttlSec * 1000);
	await db
		.insert(proxyResponseCache)
		.values({ path, queryHash, body, source, expiresAt })
		.onConflictDoUpdate({
			target: [proxyResponseCache.path, proxyResponseCache.queryHash],
			set: { body, source, expiresAt, createdAt: sql`now()` },
		});
}

/**
 * Periodic prune. Run on a schedule or as part of /healthz.
 */
export async function pruneExpired(): Promise<number> {
	const result = await db.execute(sql`delete from ${proxyResponseCache} where expires_at <= now()`);
	return result.length ?? 0;
}
