/**
 * Watchlist scan worker — runs one saved sweep end-to-end and snapshots
 * qualifying deals into `deal_queue`. Same scoring path the playground
 * Discover panel uses, exposed as a service so the in-process scheduler
 * + the manual `/v1/watchlists/:id/run-now` route can both call it.
 *
 * Pipeline:
 *   1. Active search (scrape via Oxylabs)
 *   2. Sold search for comparable pool
 *   3. LLM matcher: combined pool → matchedSold + matchedActive
 *   4. evaluate() per candidate with comparables + asks
 *   5. Filter by recommendedExit.netCents > minNetCents
 *   6. Insert into deal_queue (skip if same (watchlist, item, pending) exists)
 *
 * Idempotent: the unique index on `(watchlist_id, legacy_item_id,
 * status)` stops duplicate pending rows. Re-running a watchlist that
 * already surfaced a deal won't create a second pending row.
 */

import type { WatchlistCriteria } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { dealQueue, type Watchlist, watchlists } from "../../db/schema.js";
import { toLegacyId } from "../../utils/item-id.js";
import { evaluateWithContext } from "../evaluate/evaluate-with-context.js";
import { getItemDetail } from "../listings/detail.js";
import { searchActiveListings } from "../listings/search.js";
import { searchSoldListings } from "../listings/sold.js";
import { MatchUnavailableError, matchPool } from "../match/index.js";

const QUEUE_TTL_DAYS = 7;
const DEFAULT_LIMIT = 25;

export interface ScanResult {
	watchlistId: string;
	scanned: number;
	queued: number;
	error?: string;
}

export async function runWatchlistScan(watchlist: Watchlist): Promise<ScanResult> {
	const ranAt = new Date();
	const criteria = watchlist.criteria as WatchlistCriteria;
	try {
		const candidates = await fetchCandidates(criteria);
		const compPool = await fetchSoldPool(criteria, candidates);
		const matched = await runMatch(candidates, compPool);
		const queued = await snapshotDeals(watchlist, candidates, matched, criteria);
		await db.update(watchlists).set({ lastRunAt: ranAt, lastRunError: null }).where(eq(watchlists.id, watchlist.id));
		return { watchlistId: watchlist.id, scanned: candidates.length, queued };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db
			.update(watchlists)
			.set({ lastRunAt: ranAt, lastRunError: message.slice(0, 500) })
			.where(eq(watchlists.id, watchlist.id));
		return { watchlistId: watchlist.id, scanned: 0, queued: 0, error: message };
	}
}

async function fetchCandidates(criteria: WatchlistCriteria): Promise<ItemSummary[]> {
	if (!criteria.q || criteria.q.trim().length === 0) {
		throw new Error("watchlist criteria missing keyword (q)");
	}
	const limit = Math.min(Math.max(criteria.limit ?? DEFAULT_LIMIT, 1), 50);
	const result = await searchActiveListings({
		q: criteria.q,
		limit,
		conditionIds: criteria.conditionIds,
	});
	return result.body.itemSummaries ?? [];
}

async function fetchSoldPool(criteria: WatchlistCriteria, candidates: ItemSummary[]): Promise<ItemSummary[]> {
	const compQuery = criteria.q?.trim() || candidates[0]?.title?.split(/\s+/).slice(0, 6).join(" ") || "";
	if (!compQuery) return [];
	const result = await searchSoldListings({
		q: compQuery,
		limit: 50,
		conditionIds: criteria.conditionIds,
	});
	return result.body.itemSales ?? result.body.itemSummaries ?? [];
}

interface MatchResult {
	matchedSold: ItemSummary[];
	matchedActiveByCandidateId: Map<string, ItemSummary[]>;
}

async function runMatch(candidates: ItemSummary[], soldPool: ItemSummary[]): Promise<MatchResult> {
	if (candidates.length === 0) {
		return { matchedSold: [], matchedActiveByCandidateId: new Map() };
	}
	// Combined-pool matcher: candidate is the watchlist's first listing
	// (best representative for the q-keyword cohort), pool is sold + the
	// other actives. The LLM sorts each pool entry into match/reject; we
	// use the matched bucket as comparables for every candidate. Same shortcut
	// the playground takes for shared-pool Discover sweeps — accuracy is
	// good enough for a homogeneous watchlist; per-candidate matchers can
	// come later if a watchlist is too broad.
	const seedCandidate = candidates[0]!;
	const otherActives = candidates.slice(1);
	const seenIds = new Set(soldPool.map((s) => s.itemId));
	const combined = [...soldPool, ...otherActives.filter((a) => !seenIds.has(a.itemId))];
	try {
		const outcome = await matchPool(seedCandidate, combined, {}, { getDetail: scrapeDetailForMatcher });
		// Watchlist scans always run hosted (no human host LLM available) —
		// `matchPool` returns the hosted-mode envelope here.
		if (outcome.mode !== "hosted") {
			throw new Error("watchlist scan expected hosted matchPool outcome");
		}
		const soldIds = new Set(soldPool.map((s) => s.itemId));
		const matchedSold: ItemSummary[] = [];
		const matchedActive: ItemSummary[] = [];
		for (const m of outcome.result.body.match) {
			if (soldIds.has(m.item.itemId)) matchedSold.push(m.item);
			else matchedActive.push(m.item);
		}
		// Same matched-active set applies to every candidate in the cohort.
		const map = new Map<string, ItemSummary[]>();
		for (const c of candidates) map.set(c.itemId, matchedActive);
		return { matchedSold, matchedActiveByCandidateId: map };
	} catch (err) {
		if (err instanceof MatchUnavailableError) {
			// No LLM provider — fall back to a trivial pool: every sold
			// listing acts as a comparable. Margins / ranking still compute but
			// without same-product filtering.
			const map = new Map<string, ItemSummary[]>();
			for (const c of candidates) map.set(c.itemId, []);
			return { matchedSold: soldPool, matchedActiveByCandidateId: map };
		}
		throw err;
	}
}

async function scrapeDetailForMatcher(item: ItemSummary) {
	const itemId = toLegacyId(item);
	if (!itemId) return null;
	const result = await getItemDetail(itemId);
	return result?.body ?? null;
}

async function snapshotDeals(
	watchlist: Watchlist,
	candidates: ItemSummary[],
	matched: MatchResult,
	criteria: WatchlistCriteria,
): Promise<number> {
	const expiresAt = new Date(Date.now() + QUEUE_TTL_DAYS * 24 * 60 * 60 * 1000);
	let queued = 0;
	for (const candidate of candidates) {
		const asks = matched.matchedActiveByCandidateId.get(candidate.itemId) ?? [];
		const evaluation = await evaluateWithContext(candidate, {
			comparables: matched.matchedSold,
			asks,
			minNetCents: criteria.minNetCents,
			maxDaysToSell: criteria.maxDaysToSell,
			outboundShippingCents: criteria.outboundShippingCents,
		});
		const exit = evaluation.recommendedExit;
		// Only snapshot real opportunities — positive expected net,
		// non-skip rating. Loss-mitigation exits don't belong in the queue.
		if (!exit || exit.netCents <= 0 || evaluation.rating === "skip") continue;
		const legacyId = toLegacyId(candidate);
		if (!legacyId) continue;
		try {
			const inserted = await db
				.insert(dealQueue)
				.values({
					watchlistId: watchlist.id,
					apiKeyId: watchlist.apiKeyId,
					legacyItemId: legacyId,
					itemSnapshot: candidate as unknown as object,
					evaluationSnapshot: evaluation as unknown as object,
					itemWebUrl: candidate.itemWebUrl,
					expiresAt,
				})
				.onConflictDoNothing()
				.returning({ id: dealQueue.id });
			if (inserted.length > 0) queued++;
		} catch (err) {
			console.error("[watchlists/scan] queue insert failed:", err);
		}
	}
	return queued;
}

/**
 * Compute the next eligible run time given a watchlist's cadence.
 * Used by the scheduler to decide which watchlists are due.
 */
export function nextDueAt(cadence: Watchlist["cadence"], lastRunAt: Date | null): Date {
	if (!lastRunAt) return new Date(0);
	const offsetMs =
		cadence === "hourly" ? 60 * 60 * 1000 : cadence === "every_6h" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	return new Date(lastRunAt.getTime() + offsetMs);
}

export function isDue(watchlist: Pick<Watchlist, "cadence" | "lastRunAt">, now: Date = new Date()): boolean {
	return nextDueAt(watchlist.cadence, watchlist.lastRunAt).getTime() <= now.getTime();
}

/**
 * Move pending deal_queue rows whose `expiresAt` has passed into the
 * `expired` status. Called from the in-process scheduler so the queue
 * doesn't accumulate stale rows the dashboard would have to filter
 * client-side. Uses a single UPDATE — no row scan, no Promise.all.
 */
export async function expireStaleDealQueueRows(now: Date = new Date()): Promise<number> {
	const result = await db
		.update(dealQueue)
		.set({ status: "expired", decidedAt: now })
		.where(and(eq(dealQueue.status, "pending"), lt(dealQueue.expiresAt, now)))
		.returning({ id: dealQueue.id });
	return result.length;
}

/**
 * Pull the next batch of due, enabled watchlists and atomically claim
 * them so a sibling replica can't pick the same row. The claim is
 * `SELECT … FOR UPDATE SKIP LOCKED` followed by an in-transaction
 * `UPDATE lastRunAt = now()` which doubles as the row-level "this
 * replica is on it" marker — once committed, the row's `nextDueAt`
 * advances by the cadence offset, so other replicas see it as
 * not-due even before the scan completes.
 *
 * `lastRunAt` may temporarily be wrong if the scan errors before
 * `runWatchlistScan` overwrites it with the real timestamp + error
 * message, but the consequence is "this watchlist runs one tick
 * later than expected" — strictly safer than a double-run.
 */
export async function pickDueWatchlists(limit = 5): Promise<Watchlist[]> {
	const claimedAt = new Date();
	return db.transaction(async (tx) => {
		const candidates = await tx
			.select()
			.from(watchlists)
			.where(eq(watchlists.enabled, true))
			.orderBy(sql`${watchlists.lastRunAt} ASC NULLS FIRST`)
			.limit(limit * 4)
			.for("update", { skipLocked: true });
		const due = candidates.filter((w) => isDue(w, claimedAt)).slice(0, limit);
		if (due.length === 0) return [];
		const ids = due.map((w) => w.id);
		await tx.update(watchlists).set({ lastRunAt: claimedAt }).where(sql`${watchlists.id} = ANY(${ids}::uuid[])`);
		return due;
	});
}
