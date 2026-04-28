/**
 * Per-listing time-to-sell cache + lazy enrichment worker.
 *
 *   getDurations(itemIds)            sync read against listing_durations
 *   enrichDurationsBackground(ids)   fire-and-forget rate-limited fetcher
 *
 * The model is "best-effort eventually consistent": the read path returns
 * whatever's in cache right now; the enrichment path fills in misses
 * over time so subsequent reads see fuller data.
 *
 *   1st call:  cache cold → MarketStats without meanDaysToSell
 *   2nd call:  cache warm → meanDaysToSell populated
 *
 * Rate-limited at 1 fetch / 1.5s by default — sustainable through the
 * residential proxy without tripping eBay's bot wall.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { listingDurations } from "../db/schema.js";
import { scrapeItemDetail } from "./scrape.js";

/** Persisted as integer cents-style "days × 100" to keep schema simple. */
const DAYS_SCALE = 100;

const FETCH_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 3;
const PARALLEL_BATCH_SIZE = 1; // strictly serial — eBay rate-limits hard

/** In-process set of itemIds currently being fetched, to dedupe overlapping requests. */
const inFlight = new Set<string>();

/**
 * Read durationDays for each itemId. Missing entries are simply omitted —
 * caller treats absence as "no duration data yet, summarize without it."
 */
export async function getDurations(itemIds: string[]): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (itemIds.length === 0) return out;
	const rows = await db
		.select({ itemId: listingDurations.itemId, durationDays: listingDurations.durationDays })
		.from(listingDurations)
		.where(inArray(listingDurations.itemId, itemIds));
	for (const row of rows) {
		if (row.durationDays != null) {
			out.set(row.itemId, row.durationDays / DAYS_SCALE);
		}
	}
	return out;
}

/**
 * Identify which of `itemIds` need a fresh detail fetch — i.e. not
 * already cached and not flagged as failed-permanently.
 */
async function findCandidates(itemIds: string[]): Promise<string[]> {
	if (itemIds.length === 0) return [];
	const rows = await db
		.select({
			itemId: listingDurations.itemId,
			durationDays: listingDurations.durationDays,
			fetchFailed: listingDurations.fetchFailed,
			fetchAttempts: listingDurations.fetchAttempts,
		})
		.from(listingDurations)
		.where(inArray(listingDurations.itemId, itemIds));
	const known = new Map(rows.map((r) => [r.itemId, r]));
	const candidates: string[] = [];
	for (const id of itemIds) {
		if (inFlight.has(id)) continue;
		const row = known.get(id);
		if (!row) {
			candidates.push(id);
			continue;
		}
		if (row.durationDays != null) continue; // already filled
		if (row.fetchFailed && row.fetchAttempts >= MAX_ATTEMPTS) continue; // permanent
		candidates.push(id);
	}
	return candidates;
}

async function fetchOne(itemId: string): Promise<void> {
	inFlight.add(itemId);
	try {
		const detail = await scrapeItemDetail(itemId).catch(() => null);
		const start = detail?.itemCreationDate ? new Date(detail.itemCreationDate) : null;
		const end = detail?.itemEndDate ? new Date(detail.itemEndDate) : null;
		if (start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) {
			const durationDays = Math.round(((end.getTime() - start.getTime()) / 86_400_000) * DAYS_SCALE);
			await db
				.insert(listingDurations)
				.values({
					itemId,
					listedAt: start,
					soldAt: end,
					durationDays,
					fetchedAt: new Date(),
					fetchAttempts: 1,
					fetchFailed: false,
				})
				.onConflictDoUpdate({
					target: listingDurations.itemId,
					set: {
						listedAt: start,
						soldAt: end,
						durationDays,
						fetchedAt: new Date(),
						fetchAttempts: sql`${listingDurations.fetchAttempts} + 1`,
						fetchFailed: false,
					},
				});
		} else {
			// Detail fetch returned but no usable timestamps — bump attempts.
			await db
				.insert(listingDurations)
				.values({ itemId, fetchAttempts: 1, fetchFailed: false })
				.onConflictDoUpdate({
					target: listingDurations.itemId,
					set: {
						fetchedAt: new Date(),
						fetchAttempts: sql`${listingDurations.fetchAttempts} + 1`,
						fetchFailed: sql`${listingDurations.fetchAttempts} + 1 >= ${MAX_ATTEMPTS}`,
					},
				});
		}
	} catch (err) {
		console.error(`[durations] fetch failed for ${itemId}:`, err instanceof Error ? err.message : err);
		await db
			.insert(listingDurations)
			.values({ itemId, fetchAttempts: 1, fetchFailed: false })
			.onConflictDoUpdate({
				target: listingDurations.itemId,
				set: {
					fetchedAt: new Date(),
					fetchAttempts: sql`${listingDurations.fetchAttempts} + 1`,
					fetchFailed: sql`${listingDurations.fetchAttempts} + 1 >= ${MAX_ATTEMPTS}`,
				},
			})
			.catch(() => {});
	} finally {
		inFlight.delete(itemId);
	}
}

/**
 * Schedule cache-miss itemIds for background enrichment. Returns
 * immediately — the actual fetches run sequentially with a fixed delay
 * so we don't burst eBay's anti-bot wall. Errors are logged, not thrown.
 *
 * Caller pattern:
 *   const durations = await getDurations(soldItemIds);   // fast
 *   enrichDurationsBackground(soldItemIds);              // fire and forget
 *   return summarizeMarket(...);                         // respond now
 */
export function enrichDurationsBackground(itemIds: string[]): void {
	if (itemIds.length === 0) return;
	void (async () => {
		const candidates = await findCandidates(itemIds).catch(() => [] as string[]);
		for (let i = 0; i < candidates.length; i += PARALLEL_BATCH_SIZE) {
			const batch = candidates.slice(i, i + PARALLEL_BATCH_SIZE);
			await Promise.all(batch.map(fetchOne));
			if (i + PARALLEL_BATCH_SIZE < candidates.length) {
				await new Promise((r) => setTimeout(r, FETCH_INTERVAL_MS));
			}
		}
	})();
}

/**
 * Drop a single itemId's cache entry — used by the takedown handler
 * when a seller opts out, so we stop serving their listing's data.
 */
export async function deleteDuration(itemId: string): Promise<void> {
	await db.delete(listingDurations).where(eq(listingDurations.itemId, itemId));
}
