/**
 * Upstream phase of the evaluate pipeline — everything that depends
 * only on `(itemId, lookbackDays, soldLimit)` and not on user opts:
 * item detail, sold/active search, same-product LLM filter, market
 * stats, sold/active digests, filter summary, returns. Result is the
 * `MarketDataDigest`, cached cross-user in `market_data_cache`.
 *
 * Per-user scoring (forwarder cost, minNet thresholds → `evaluation`)
 * runs on top in `score.ts` and lands in `compute_jobs.result` as a
 * self-contained snapshot. The cache is purely an internal cost
 * optimization — User B never sees User A's identity or trace.
 *
 * Three paths:
 *   1. cache HIT       — emit one synthetic "cached" step, return digest
 *   2. cross-user attach — emit "attached" step, poll until leader writes
 *                          cache or the wait deadline elapses
 *   3. MISS            — run detail + search + filter + digest assembly,
 *                        write to cache, return digest
 *
 * Concurrency: the unique index on `(item_id, lookback_days, sold_limit)`
 * + `ON CONFLICT DO NOTHING` write means simultaneous fetchers don't
 * coordinate via locks — first to insert wins, others' writes are
 * silent no-ops. Result is identical regardless (deterministic upstream).
 */

import type { EvaluatePartial, TransportSource } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type ApiKey, type MarketDataCache, marketDataCache } from "../../db/schema.js";
import { findInProgressUpstreamJob, getJobStatus } from "../compute-jobs/queue.js";
import { tierConditionIdsFor } from "../items/condition-tier.js";
import { getItemDetail } from "../items/detail.js";
import { MultiVariationParentError } from "../items/errors.js";
import { searchActiveListings } from "../items/search.js";
import { searchSoldListings } from "../items/sold.js";
import { marketFromSold } from "./adapter.js";
import { buildActiveDigest, buildFilterSummary, buildSoldDigest } from "./digest.js";
import { buildPath, EvaluateError, emitPartial, type PipelineListener, runMatchFilter, withStep } from "./pipeline.js";
import { extractReturns } from "./returns.js";

/* --------------------------------- types --------------------------------- */

/**
 * The cacheable pre-scoring digest. Everything here is deterministic
 * from `(itemId, lookbackDays, soldLimit)` — same inputs → same digest,
 * regardless of which user kicked off the fetch.
 */
export interface MarketDataDigest {
	item: unknown;
	market: unknown;
	sold: unknown;
	active: unknown;
	filter: unknown;
	returns: unknown;
	meta: unknown;
	matchedSold: ItemSummary[];
	matchedActive: ItemSummary[];
	rejectedSold: ItemSummary[];
	rejectedActive: ItemSummary[];
	rejectionReasons: Record<string, string>;
	rejectionCategories: Record<string, string>;
}

export interface FetchMarketDataInput {
	itemId: string;
	legacyId: string;
	variationId: string | undefined;
	lookbackDays: number;
	soldLimit: number;
	apiKey?: ApiKey;
	/** compute_jobs row id of the caller. Used to exclude self from cross-user in-flight lookup. */
	jobId?: string;
	onStep?: PipelineListener;
	cancelCheck?: () => Promise<void>;
}

/* --------------------------------- knobs --------------------------------- */

/** TTL aligned with the sold-search transport cache. Sold lists are the slowest-changing axis. */
const MARKET_DATA_TTL_MS = 12 * 60 * 60_000;

/** Max time the attach path waits for a cross-user leader before falling through to fetch ourselves. */
const ATTACH_MAX_WAIT_MS = 90_000;
const ATTACH_POLL_INTERVAL_MS = 1_000;

const LABELS = {
	detail: "Look up listing",
	"search.sold": "Recent sales",
	"search.active": "Active competition",
	filter: "Filter same product",
	cached: "Cached upstream",
	attached: "Awaiting in-flight upstream",
} as const;

/* ----------------------------- orchestrator ----------------------------- */

export async function fetchOrAwaitMarketData(input: FetchMarketDataInput): Promise<MarketDataDigest> {
	const { itemId, lookbackDays, soldLimit, jobId, onStep, cancelCheck } = input;

	// 1. Cache hit?
	const cached = await readFreshCache(itemId, lookbackDays, soldLimit);
	if (cached) {
		emitCachedStep(onStep, cached.expiresAt);
		return cached.digest;
	}

	// 2. Cross-user in-flight attach? Skip when we don't know our own
	// jobId (sync /v1/evaluate path also passes jobId; this branch only
	// fires when a caller explicitly chose to skip dedup).
	if (jobId) {
		if (cancelCheck) await cancelCheck();
		const leader = await findInProgressUpstreamJob(itemId, lookbackDays, soldLimit, jobId);
		if (leader) {
			const attached = await tryAttach(leader.id, itemId, lookbackDays, soldLimit, { onStep, cancelCheck });
			if (attached) return attached;
			// Leader timed out / failed — fall through and do it ourselves.
		}
	}

	// 3. Fetch + write
	return await runUpstreamAndCache(input);
}

/* ----------------------------- cache reads ----------------------------- */

async function readFreshCache(
	itemId: string,
	lookbackDays: number,
	soldLimit: number,
): Promise<{ digest: MarketDataDigest; expiresAt: Date } | null> {
	// Defensive: a DB blip should degrade to MISS, not break the pipeline.
	// `compute_jobs` writes happen in the worker dispatcher and have their
	// own error path; the cache layer is purely opportunistic.
	try {
		const rows = await db
			.select()
			.from(marketDataCache)
			.where(
				and(
					eq(marketDataCache.itemId, itemId),
					eq(marketDataCache.lookbackDays, lookbackDays),
					eq(marketDataCache.soldLimit, soldLimit),
					gt(marketDataCache.expiresAt, new Date()),
				),
			)
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return { digest: row.digest as MarketDataDigest, expiresAt: row.expiresAt };
	} catch (err) {
		console.warn("[market-data] cache read failed; falling through to fetch:", (err as Error).message);
		return null;
	}
}

function emitCachedStep(onStep: PipelineListener | undefined, expiresAt: Date): void {
	if (!onStep) return;
	onStep({ kind: "started", key: "cached", label: LABELS.cached });
	onStep({
		kind: "succeeded",
		key: "cached",
		result: { hit: true, expiresAt: expiresAt.toISOString() },
		durationMs: 0,
	});
}

/* ----------------------------- attach path ----------------------------- */

/**
 * Wait for an in-flight leader to populate `market_data_cache`. Returns
 * the digest on success, or null if the leader timed out / failed
 * without writing — the caller falls through to fetch upstream itself.
 *
 * Emits a single `attached` step covering the whole wait so the trace
 * UI shows one row instead of streaming nothing for up to 90s.
 */
async function tryAttach(
	leaderId: string,
	itemId: string,
	lookbackDays: number,
	soldLimit: number,
	{ onStep, cancelCheck }: { onStep?: PipelineListener; cancelCheck?: () => Promise<void> },
): Promise<MarketDataDigest | null> {
	const start = performance.now();
	onStep?.({ kind: "started", key: "attached", label: LABELS.attached });

	const deadline = Date.now() + ATTACH_MAX_WAIT_MS;
	while (Date.now() < deadline) {
		if (cancelCheck) await cancelCheck();

		const cached = await readFreshCache(itemId, lookbackDays, soldLimit);
		if (cached) {
			onStep?.({
				kind: "succeeded",
				key: "attached",
				result: { attachedTo: leaderId, hit: true },
				durationMs: Math.round(performance.now() - start),
			});
			return cached.digest;
		}

		const status = await getJobStatus(leaderId);
		if (status === "completed" || status === "failed" || status === "cancelled") {
			// Leader finished without writing cache (failed mid-pipeline,
			// cancelled, or completed with no upstream phase — shouldn't
			// happen but guard). Tell the caller to fall through.
			onStep?.({
				kind: "succeeded",
				key: "attached",
				result: { attachedTo: leaderId, hit: false, leaderStatus: status, fellBack: true },
				durationMs: Math.round(performance.now() - start),
			});
			return null;
		}

		await sleep(ATTACH_POLL_INTERVAL_MS);
	}

	onStep?.({
		kind: "succeeded",
		key: "attached",
		result: { attachedTo: leaderId, hit: false, timedOut: true, fellBack: true },
		durationMs: Math.round(performance.now() - start),
	});
	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ----------------------------- fetch + cache ----------------------------- */

async function runUpstreamAndCache(input: FetchMarketDataInput): Promise<MarketDataDigest> {
	const { itemId, legacyId, variationId, lookbackDays, soldLimit, apiKey, jobId, onStep, cancelCheck } = input;

	// detail ------------------------------------------------------------
	const detail = await withStep(
		{
			key: "detail",
			label: LABELS.detail,
			request: { method: "GET", path: `/v1/items/${encodeURIComponent(itemId)}` },
			onStep,
			cancelCheck,
		},
		async () => {
			let detailResult: Awaited<ReturnType<typeof getItemDetail>>;
			try {
				detailResult = await getItemDetail(legacyId, { apiKey, variationId });
			} catch (err) {
				if (err instanceof MultiVariationParentError) {
					throw new EvaluateError(
						"variation_required",
						422,
						`Listing ${err.legacyId} is a multi-SKU parent with ${err.variations.length} variations; retry with a specific variationId.`,
						{ legacyId: err.legacyId, variations: err.variations },
					);
				}
				throw err;
			}
			if (!detailResult) throw new EvaluateError("item_not_found", 404, `No detail found for "${itemId}".`);
			if (!detailResult.body.title?.trim()) {
				throw new EvaluateError("no_title", 422, `Item "${itemId}" has no title.`);
			}
			const detailBody = detailResult.body as {
				variations?: ReadonlyArray<unknown>;
				image?: { imageUrl?: string };
				title?: string;
			};
			if (!variationId && detailBody.variations && detailBody.variations.length > 0) {
				const variations = detailBody.variations;
				throw new EvaluateError(
					"variation_required",
					422,
					`Listing ${legacyId} is a multi-SKU parent with ${variations.length} variations; retry with a specific variationId.`,
					{
						legacyId,
						variations,
						...(detailBody.image?.imageUrl ? { parentImageUrl: detailBody.image.imageUrl } : {}),
						...(detailBody.title ? { parentTitle: detailBody.title } : {}),
					},
				);
			}
			return {
				value: detailResult,
				result: detailResult.body,
				source: detailResult.source as TransportSource,
			};
		},
	);

	// detail-derived state hydrates immediately. `item` lets the hero
	// render before the matcher has even started; `returns` populates
	// the trust chip on the Buy-at row in parallel — both are pure
	// projections over the detail body, no extra IO.
	const returnsValue = extractReturns(detail.body);
	emitPartial(onStep, { item: detail.body as EvaluatePartial["item"], returns: returnsValue });

	// search (parallel) -------------------------------------------------
	const q = (detail.body as { title: string }).title.trim();
	const DAY_MS = 86_400_000;
	const sinceMs = Math.floor(Date.now() / DAY_MS) * DAY_MS - lookbackDays * DAY_MS;
	const since = new Date(sinceMs).toISOString();
	const lookbackFilter = `lastSoldDate:[${since}..]`;

	const candidateConditionIds = tierConditionIdsFor((detail.body as { conditionId?: string }).conditionId);
	const conditionFilter = candidateConditionIds ? `conditionIds:{${candidateConditionIds.join("|")}}` : null;
	const soldFilter = conditionFilter ? `${lookbackFilter},${conditionFilter}` : lookbackFilter;
	const activeFilter = conditionFilter ?? undefined;

	if (cancelCheck) await cancelCheck();
	onStep?.({ kind: "started", key: "search", label: "Search market" });
	const searchStart = performance.now();
	const [soldSettled, activeSettled] = await Promise.allSettled([
		withStep(
			{
				key: "search.sold",
				label: LABELS["search.sold"],
				parent: "search",
				request: {
					method: "GET",
					path: buildPath("/v1/items/search?status=sold", {
						q,
						limit: soldLimit,
						filter: soldFilter,
					}),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchSoldListings({ q, limit: soldLimit, filter: soldFilter }, { apiKey });
				const items = r.body.itemSales ?? r.body.itemSummaries ?? [];
				// Hydrate the UI's sold pool the moment the search returns.
				// The trace step's `result` stays a count summary for
				// observability — the heavy items array travels on the
				// partial channel, single source of truth for state.
				emitPartial(onStep, { soldPool: items });
				return {
					value: { items, source: r.source as TransportSource },
					result: { count: items.length },
					source: r.source as TransportSource,
				};
			},
		),
		withStep(
			{
				key: "search.active",
				label: LABELS["search.active"],
				parent: "search",
				request: {
					method: "GET",
					path: buildPath("/v1/items/search", { q, limit: 50, filter: activeFilter }),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchActiveListings({ q, limit: 50, filter: activeFilter }, { apiKey });
				const items = r.body.itemSummaries ?? [];
				emitPartial(onStep, { activePool: items });
				return {
					value: { items, source: r.source as TransportSource },
					result: { count: items.length },
					source: r.source as TransportSource,
				};
			},
		),
	]);
	const searchDurationMs = Math.round(performance.now() - searchStart);
	for (const settled of [soldSettled, activeSettled] as const) {
		if (settled.status === "rejected") {
			const message = String((settled.reason as Error)?.message ?? settled.reason);
			onStep?.({ kind: "failed", key: "search", error: message, durationMs: searchDurationMs });
			const aborted = new EvaluateError("search_failed", 502, message);
			(aborted as { __stepEmitted?: true }).__stepEmitted = true;
			throw aborted;
		}
	}
	const soldPool = soldSettled.status === "fulfilled" ? soldSettled.value.items : [];
	const soldSource = soldSettled.status === "fulfilled" ? soldSettled.value.source : null;
	const activePool = activeSettled.status === "fulfilled" ? activeSettled.value.items : [];
	const activeSource = activeSettled.status === "fulfilled" ? activeSettled.value.source : null;
	onStep?.({
		kind: "succeeded",
		key: "search",
		result: { soldCount: soldPool.length, activeCount: activePool.length },
		durationMs: searchDurationMs,
	});

	// Preliminary stats — computed from the raw pool before the LLM
	// filter runs. Carries `preliminary: true` so UI surfaces (the
	// playground notice, the embed eyebrow) can mark them as "verifying"
	// until the post-filter partial overwrites with confirmed numbers.
	// Seed (detail.body) feeds the per-listing rate blend so multi-quantity
	// listings surface a faster `salesPerDay` when their own sell-through
	// outpaces the comp pool — see `applySeedBlend` in adapter.ts.
	const prelimMarket = marketFromSold(soldPool, undefined, undefined, activePool, detail.body);
	const prelimSold = buildSoldDigest(
		soldPool,
		(prelimMarket as { windowDays: number }).windowDays,
		(prelimMarket as { salesPerDay: number }).salesPerDay,
		(prelimMarket as { meanDaysToSell: number | null }).meanDaysToSell ?? null,
	);
	const prelimActive = buildActiveDigest(activePool);
	emitPartial(onStep, {
		market: prelimMarket as EvaluatePartial["market"],
		sold: prelimSold,
		active: prelimActive,
		preliminary: true,
	});

	// filter ------------------------------------------------------------
	// One real step in the trace. Per-chunk progress streams as typed
	// `partial` events (filterProgress) so the UI updates the bar /
	// chip / eyebrow without polluting the trace with a row per chunk.
	const filtered = await withStep({ key: "filter", label: LABELS.filter, onStep, cancelCheck }, async () => {
		const f = await runMatchFilter(
			detail.body as ItemSummary,
			soldPool,
			activePool,
			apiKey,
			undefined,
			{ seed: detail.source ?? null, sold: soldSource, active: activeSource },
			(progress) => {
				emitPartial(onStep, {
					filterProgress: { processed: progress.processed, total: progress.total },
				});
			},
		);
		return {
			value: f,
			result: {
				llmRan: f.llmRan,
				soldKept: f.matchedSold.length,
				soldRejected: f.rejectedSold.length,
				activeKept: f.matchedActive.length,
				activeRejected: f.rejectedActive.length,
			},
		};
	});

	// assemble digest (pure transforms — no step emission) -------------
	const market = marketFromSold(filtered.matchedSold, undefined, undefined, filtered.matchedActive, detail.body);
	const sold = buildSoldDigest(
		filtered.matchedSold,
		(market as { windowDays: number }).windowDays,
		(market as { salesPerDay: number }).salesPerDay,
		(market as { meanDaysToSell: number | null }).meanDaysToSell ?? null,
	);
	const active = buildActiveDigest(filtered.matchedActive);
	const filter = buildFilterSummary(
		filtered.matchedSold.length,
		filtered.rejectedSold.length,
		filtered.matchedActive.length,
		filtered.rejectedActive.length,
		filtered.rejectionReasons,
		filtered.rejectionCategories,
	);
	const returns = returnsValue;
	const meta = {
		itemSource: detail.source as TransportSource,
		soldCount: filtered.matchedSold.length,
		soldSource,
		activeCount: filtered.matchedActive.length,
		activeSource,
		soldKept: filtered.matchedSold.length,
		soldRejected: filtered.rejectedSold.length,
		activeKept: filtered.matchedActive.length,
		activeRejected: filtered.rejectedActive.length,
	};

	const digest: MarketDataDigest = {
		item: detail.body,
		market,
		sold,
		active,
		filter,
		returns,
		meta,
		matchedSold: filtered.matchedSold,
		matchedActive: filtered.matchedActive,
		rejectedSold: filtered.rejectedSold,
		rejectedActive: filtered.rejectedActive,
		rejectionReasons: filtered.rejectionReasons,
		rejectionCategories: filtered.rejectionCategories,
	};

	// Confirmed digest. Replaces the preliminary partial in one merge —
	// matched pools become the new soldPool/activePool, rejected pools
	// land alongside, and `preliminary: false` flips the UI's verifying
	// indicator off. Single typed patch, no synthetic step row.
	emitPartial(onStep, {
		market: market as EvaluatePartial["market"],
		sold,
		active,
		filter,
		meta: meta as EvaluatePartial["meta"],
		soldPool: filtered.matchedSold,
		activePool: filtered.matchedActive,
		rejectedSoldPool: filtered.rejectedSold,
		rejectedActivePool: filtered.rejectedActive,
		rejectionReasons: filtered.rejectionReasons,
		rejectionCategories: filtered.rejectionCategories,
		preliminary: false,
	});

	// Persist for cross-user reuse. Race-tolerant: simultaneous fetchers
	// both INSERT, the second silently no-ops on the unique-index conflict.
	await writeCache(itemId, lookbackDays, soldLimit, digest, jobId);

	return digest;
}

async function writeCache(
	itemId: string,
	lookbackDays: number,
	soldLimit: number,
	digest: MarketDataDigest,
	sourceJobId: string | undefined,
): Promise<void> {
	// Defensive: cache write failures shouldn't fail the pipeline. The
	// caller already has the digest in hand and is about to return it.
	try {
		const expiresAt = new Date(Date.now() + MARKET_DATA_TTL_MS);
		await db
			.insert(marketDataCache)
			.values({
				itemId,
				lookbackDays,
				soldLimit,
				digest: digest as object,
				sourceJobId: sourceJobId ?? null,
				expiresAt,
			})
			.onConflictDoNothing({
				target: [marketDataCache.itemId, marketDataCache.lookbackDays, marketDataCache.soldLimit],
			});
	} catch (err) {
		console.warn("[market-data] cache write failed; pipeline result still returned:", (err as Error).message);
	}
}

/** Test seam — exported only so unit tests can stub the cache layer. */
export const __testing = {
	readFreshCache,
	writeCache,
	MARKET_DATA_TTL_MS,
	ATTACH_MAX_WAIT_MS,
};

export type { MarketDataCache };
