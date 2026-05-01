/**
 * `/v1/discover` pipeline. Query-driven; finds K unique product
 * variants from a search and runs the Evaluate pipeline on each.
 *
 *   01 search.candidates  — broad active search (raw candidate pool)
 *   02 cluster            — deterministic bucket (epid → gtin → singleton)
 *   03 partition          — LLM variant partition WITHIN each bucket so
 *                           same-canonical / different-condition (or
 *                           size / grade / year / …) listings fall into
 *                           separate clusters. Generic — no hardcoded
 *                           axes; LLM uses title + condition + aspects +
 *                           image + GTIN. Same "would a buyer expecting
 *                           X accept Y as a substitute?" frame as
 *                           Evaluate's filter pass, applied symmetrically
 *                           inside the bucket.
 *   04 detail             — parent; per-cluster children fetch the
 *                           representative's full ItemDetail
 *   05 search.sold        — parent; per-cluster sold search by canonical
 *   06 search.active      — parent; per-cluster active search by canonical
 *                           (parallel with 05), merged with the variant's
 *                           step-01 slice and deduped by itemId so step 07
 *                           sees the full asks distribution for this SKU,
 *                           not just whatever fell out of the broad query
 *   07 filter             — parent; per-cluster same-product matcher
 *                           (sold + merged active in one matchPool call)
 *   08 evaluate           — parent; per-cluster scoring
 *
 * Each variant cluster's sub-flow IS a per-product Evaluate run. The
 * representative is the cheapest active listing in the cluster (the
 * reseller's natural entry point — `recommendedExit` is the same
 * across same-variant listings, so cheapest = highest expected net).
 *
 * Partial success is tolerated: failed variant sub-flows drop out and
 * the survivors aggregate. Only when ALL variant clusters fail do we
 * throw `not_enough_sold`.
 */

import type { DealCluster, DiscoverMeta, EvaluateMeta, MarketStats, TransportSource } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import type { ApiKey } from "../../db/schema.js";
import { legacyFromV1, parseItemId, toLegacyId } from "../../utils/item-id.js";
import { Semaphore } from "../../utils/semaphore.js";
import { getItemDetail } from "../listings/detail.js";
import { searchActiveListings } from "../listings/search.js";
import { searchSoldListings } from "../listings/sold.js";
import { type Cluster, clusterByProduct } from "../match/cluster.js";
import { partitionByVariant } from "../match/partition-by-variant.js";
import { marketFromSold } from "./adapter.js";
import { enrichWithDuration, evaluateWithContext } from "./evaluate-with-context.js";
import {
	buildPath,
	EvaluateError,
	type MatchFilterResult,
	runMatchFilter,
	type StepListener,
	withStep,
} from "./pipeline.js";
import { extractReturns } from "./returns.js";
import type { EvaluateOptions } from "./types.js";

// Re-export the shared error + event types so route layers that drive
// /v1/discover only need to import from run-discover.js (mirrors how
// /v1/evaluate routes import from run.js).
export type { StepEvent, StepListener, StepRequestInfo } from "./pipeline.js";
export { EvaluateError, wasEmittedAsStep } from "./pipeline.js";

const LABELS = {
	"search.candidates": "Find candidate pool",
	cluster: "Group products",
	partition: "Split by variant",
	detail: "Look up representatives",
	"search.sold": "Find recent sales",
	"search.active": "Find active competition",
	filter: "Filter same product",
	evaluate: "Score variants",
} as const;

export interface RunDiscoverInput {
	q: string;
	categoryId?: string;
	filter?: string;
	limit?: number;
	/** Sold-search lookback window in days (default 90). Mirrors evaluate. */
	lookbackDays?: number;
	/** Sold-search result cap per cluster (default 50). Mirrors evaluate. */
	soldLimit?: number;
	apiKey?: ApiKey;
	opts?: EvaluateOptions;
	onStep?: StepListener;
	/** Cooperative cancel — supplied by the compute-job dispatcher; throws `CancelledError` when the user cancelled. */
	cancelCheck?: () => Promise<void>;
}

export interface RunDiscoverResult {
	clusters: DealCluster[];
	meta: DiscoverMeta;
}

/**
 * One variant cluster: a set of active listings that the LLM partition
 * judged to be the same product at the same variant tier (same
 * condition, same size if applicable, etc.). The unit Evaluate operates
 * on. `source` carries the deterministic bucket origin so the response
 * can surface "this came from an EPID-linked SKU vs a singleton title".
 */
interface VariantCluster {
	canonical: string;
	source: Cluster["source"];
	items: ItemSummary[];
}

function pickRepresentative(items: ReadonlyArray<ItemSummary>): ItemSummary {
	let cheapest = items[0]!;
	let bestPrice = parsePriceCents(cheapest);
	for (let i = 1; i < items.length; i++) {
		const it = items[i]!;
		const p = parsePriceCents(it);
		if (p != null && (bestPrice == null || p < bestPrice)) {
			cheapest = it;
			bestPrice = p;
		}
	}
	return cheapest;
}

function parsePriceCents(item: ItemSummary): number | null {
	const v = item.price?.value;
	if (!v) return null;
	const n = Math.round(Number.parseFloat(v) * 100);
	return Number.isFinite(n) ? n : null;
}

function pickCanonical(items: ReadonlyArray<ItemSummary>): string {
	// Cleanest title in the variant cluster — drop emoji-laden / all-caps
	// spam titles in favor of a plain one for the sold-search query. If
	// every title is spammy, fall back to the first.
	const cleaner = (t: string) => t.replace(/[^ -~]/g, "").trim();
	const candidates = items
		.map((i) => i.title)
		.filter(Boolean)
		.map((t) => ({ original: t, clean: cleaner(t), score: scoreTitleQuality(t) }));
	if (candidates.length === 0) return items[0]!.title;
	candidates.sort((a, b) => b.score - a.score);
	return candidates[0]!.clean || candidates[0]!.original;
}

function scoreTitleQuality(t: string): number {
	// Higher is better. Penalises emoji, all-caps, "READ DESCRIPTION",
	// "🔥", "💥", etc. Rewards alphanumeric word ratio.
	let score = 0;
	const upperRatio = (t.match(/[A-Z]/g)?.length ?? 0) / Math.max(t.length, 1);
	score -= upperRatio * 30;
	score -= (t.match(/[^ -~]/g)?.length ?? 0) * 5;
	score -= /(read description|must see|limited|huge discount|today only|selling fast)/i.test(t) ? 20 : 0;
	score += Math.min(40, t.length * 0.5);
	return score;
}

export async function runDiscoverPipeline(input: RunDiscoverInput): Promise<RunDiscoverResult> {
	const {
		q,
		categoryId,
		filter,
		limit = 50,
		lookbackDays = 90,
		soldLimit = 50,
		apiKey,
		opts,
		onStep,
		cancelCheck,
	} = input;

	// 01. broad active candidate pool ------------------------------------
	const active = await withStep(
		{
			key: "search.candidates",
			label: LABELS["search.candidates"],
			request: {
				method: "GET",
				path: buildPath("/v1/buy/browse/item_summary/search", {
					q,
					category_ids: categoryId,
					filter,
					limit,
				}),
			},
			onStep,
			cancelCheck,
		},
		async () => {
			const r = await searchActiveListings({ q, categoryIds: categoryId, filter, limit }, { apiKey });
			const items = r.body.itemSummaries ?? [];
			if (items.length === 0 || !items[0]?.title) {
				throw new EvaluateError(
					"no_candidates",
					422,
					`Active search for "${q}" returned no candidates with titles. Try a broader query, drop the category filter, or relax the price range.`,
				);
			}
			return {
				value: { items, source: r.source as TransportSource },
				result: { count: items.length, items },
				source: r.source as TransportSource,
			};
		},
	);
	const candidates = active.items;

	// 02. deterministic bucket -------------------------------------------
	const buckets = await withStep({ key: "cluster", label: LABELS.cluster, onStep, cancelCheck }, async () => {
		const groups = clusterByProduct(candidates);
		return {
			value: groups,
			result: {
				count: groups.length,
				groups: groups.map((g) => ({ canonical: g.canonical, n: g.items.length, source: g.source })),
			},
		};
	});

	// 03. LLM partition WITHIN each bucket -------------------------------
	// Same-canonical listings can mix conditions / sizes / years.
	// `partitionByVariant` splits each multi-item bucket into K variant
	// clusters using the same LLM same-product judgment Evaluate's filter
	// pass uses. Singletons skip the LLM and pass through.
	const variantClusters = await withStep(
		{ key: "partition", label: LABELS.partition, onStep, cancelCheck },
		async () => {
			const out: VariantCluster[] = [];
			for (const bucket of buckets) {
				if (bucket.items.length <= 1) {
					out.push({ canonical: bucket.canonical, source: bucket.source, items: [...bucket.items] });
					continue;
				}
				const variants = await partitionByVariant(bucket.items, apiKey);
				for (const variantItems of variants) {
					out.push({
						canonical: pickCanonical(variantItems),
						source: bucket.source,
						items: variantItems,
					});
				}
			}
			return {
				value: out,
				result: {
					bucketCount: buckets.length,
					variantCount: out.length,
					variants: out.map((v) => ({ canonical: v.canonical, n: v.items.length, source: v.source })),
				},
			};
		},
	);

	// Emit cluster.identified RIGHT after partition succeeds so the UI
	// can render K placeholders before any cluster's data lands.
	onStep?.({
		kind: "cluster.identified",
		clusters: variantClusters.map((c, idx) => ({
			idx,
			canonical: c.canonical,
			source: c.source,
			itemCount: c.items.length,
		})),
	});

	// 04 + 05 + 06 + 07 + 08. per-variant Evaluate sub-flow (parallel) ---
	onStep?.({ kind: "started", key: "detail", label: LABELS.detail });
	onStep?.({ kind: "started", key: "search.sold", label: LABELS["search.sold"] });
	onStep?.({ kind: "started", key: "search.active", label: LABELS["search.active"] });
	onStep?.({ kind: "started", key: "filter", label: LABELS.filter });
	onStep?.({ kind: "started", key: "evaluate", label: LABELS.evaluate });
	const detailStart = performance.now();
	const searchSoldStart = performance.now();
	const searchActiveStart = performance.now();
	const filterStart = performance.now();
	const evaluateStart = performance.now();

	const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
	const lookbackFilter = `lastSoldDate:[${since}..]`;

	// Cap variant fan-out — without this, a 50-variant cluster set
	// queues 50 concurrent sub-flows, each fanning ~3 scrapes and a few
	// LLM calls. The Oxylabs semaphore (40) backstops the scrape side,
	// but holding 50 in-flight promises with their captured memory
	// drives the worker's peak set up unnecessarily. 6 keeps memory
	// predictable while giving each sub-flow enough parallel scrape
	// slots to make progress. Tunable via env without a code change.
	const variantConcurrency = Number.parseInt(process.env.DISCOVER_VARIANT_CONCURRENCY ?? "6", 10);
	const variantSlot = new Semaphore(variantConcurrency);
	const settled = await Promise.allSettled(
		variantClusters.map((vc, idx) =>
			variantSlot.run(() =>
				runVariantSubFlow(vc, idx, {
					soldLimit,
					lookbackFilter,
					lookbackDays,
					apiKey,
					opts,
					onStep,
					cancelCheck,
				}),
			),
		),
	);

	const successful: DealCluster[] = [];
	for (const r of settled) if (r.status === "fulfilled") successful.push(r.value);

	const detailDuration = Math.round(performance.now() - detailStart);
	const searchSoldDuration = Math.round(performance.now() - searchSoldStart);
	const searchActiveDuration = Math.round(performance.now() - searchActiveStart);
	const filterDuration = Math.round(performance.now() - filterStart);
	const evaluateDuration = Math.round(performance.now() - evaluateStart);

	if (successful.length === 0) {
		// Per-variant 0 sold is no longer a failure (variants flow through
		// with `nObservations: 0`), so reaching here means every variant's
		// sub-flow hit a real error: scrape upstream, missing detail, etc.
		// The first rejection's message is the most informative one.
		const firstReason = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
		const err = firstReason
			? String((firstReason.reason as Error)?.message ?? firstReason.reason)
			: "every variant cluster's sub-flow failed";
		onStep?.({ kind: "failed", key: "detail", error: err, durationMs: detailDuration });
		onStep?.({ kind: "failed", key: "search.sold", error: err, durationMs: searchSoldDuration });
		onStep?.({ kind: "failed", key: "search.active", error: err, durationMs: searchActiveDuration });
		onStep?.({ kind: "failed", key: "filter", error: err, durationMs: filterDuration });
		onStep?.({ kind: "failed", key: "evaluate", error: err, durationMs: evaluateDuration });
		throw new EvaluateError("search_failed", 502, err);
	}

	successful.sort((a, b) => {
		const ya = a.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
		const yb = b.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
		return yb - ya;
	});

	onStep?.({
		kind: "succeeded",
		key: "detail",
		result: { clusters: successful.length },
		durationMs: detailDuration,
	});
	onStep?.({
		kind: "succeeded",
		key: "search.sold",
		result: { clusters: successful.length, totalSold: successful.reduce((s, c) => s + c.soldPool.length, 0) },
		durationMs: searchSoldDuration,
	});
	onStep?.({
		kind: "succeeded",
		key: "search.active",
		result: { clusters: successful.length, totalActive: successful.reduce((s, c) => s + c.activePool.length, 0) },
		durationMs: searchActiveDuration,
	});
	onStep?.({
		kind: "succeeded",
		key: "filter",
		result: {
			clusters: successful.length,
			soldKept: successful.reduce((s, c) => s + c.soldPool.length, 0),
			soldRejected: successful.reduce((s, c) => s + c.rejectedSoldPool.length, 0),
			activeKept: successful.reduce((s, c) => s + c.activePool.length, 0),
			activeRejected: successful.reduce((s, c) => s + c.rejectedActivePool.length, 0),
		},
		durationMs: filterDuration,
	});
	onStep?.({
		kind: "succeeded",
		key: "evaluate",
		result: { clusters: successful.length },
		durationMs: evaluateDuration,
	});

	const meta: DiscoverMeta = {
		activeCount: candidates.length,
		activeSource: active.source,
		soldCount: successful.reduce((s, c) => s + c.soldPool.length, 0),
		soldSource: successful[0]!.meta.soldSource ?? active.source,
		clusterCount: successful.length,
	};

	return { clusters: successful, meta };
}

/**
 * Run one variant cluster's full Evaluate sub-flow. Parallel-safe.
 * Throws when the sub-flow can't produce a usable result — caller's
 * `Promise.allSettled` lets one failure not poison the others.
 */
async function runVariantSubFlow(
	variant: VariantCluster,
	idx: number,
	ctx: {
		soldLimit: number;
		lookbackFilter: string;
		lookbackDays: number;
		apiKey: ApiKey | undefined;
		opts: EvaluateOptions | undefined;
		onStep: StepListener | undefined;
		cancelCheck: (() => Promise<void>) | undefined;
	},
): Promise<DealCluster> {
	const { soldLimit, lookbackFilter, lookbackDays, apiKey, opts, onStep, cancelCheck } = ctx;
	const rep = pickRepresentative(variant.items);
	const canonical = variant.canonical;

	// 04. fetch representative's full detail. Cached 4h; the matcher's
	// verify pass on this rep would fetch it anyway so this is usually a
	// cache hit by the time it lands here.
	const detail = await withStep(
		{
			key: `detail.${idx}`,
			parent: "detail",
			label: canonical,
			request: { method: "GET", path: `/v1/buy/browse/item/${encodeURIComponent(rep.itemId)}` },
			onStep,
			cancelCheck,
		},
		async () => {
			// `parseItemId` is strict (requires \d{6,}); `legacyFromV1` is the
			// looser fallback for non-conforming ids (test fixtures, weird
			// upstream payloads). Variation id only carries through when the
			// strict path matched.
			const parsed = parseItemId(rep.itemId);
			const legacyId = toLegacyId(rep) ?? parsed?.legacyId ?? legacyFromV1(rep.itemId);
			if (!legacyId) {
				throw new EvaluateError(
					"item_not_found",
					404,
					`Representative for "${canonical}" has no resolvable legacy id.`,
				);
			}
			const r = await getItemDetail(legacyId, { apiKey, variationId: parsed?.variationId });
			if (!r) {
				throw new EvaluateError("item_not_found", 404, `No detail for representative of "${canonical}".`);
			}
			return {
				value: { detail: r.body, source: r.source as TransportSource },
				result: r.body,
				source: r.source as TransportSource,
			};
		},
	);
	const repDetail: ItemDetail = detail.detail;

	// 05 + 06. parallel sold + active search by canonical. Active uses
	// limit=50 to match /v1/evaluate's per-listing fan-out so the asks
	// distribution feeding step 08 is the same size /v1/evaluate would
	// see — not just whatever fell into this cluster from step 01.
	const [sold, freshActive] = await Promise.all([
		withStep(
			{
				key: `search.sold.${idx}`,
				parent: "search.sold",
				label: canonical,
				request: {
					method: "GET",
					path: buildPath("/v1/buy/marketplace_insights/item_sales/search", {
						q: canonical,
						limit: soldLimit,
						filter: lookbackFilter,
					}),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchSoldListings({ q: canonical, limit: soldLimit, filter: lookbackFilter }, { apiKey });
				const items = r.body.itemSales ?? r.body.itemSummaries ?? [];
				return {
					value: { items, source: r.source as TransportSource },
					result: { count: items.length, items },
					source: r.source as TransportSource,
				};
			},
		),
		withStep(
			{
				key: `search.active.${idx}`,
				parent: "search.active",
				label: canonical,
				request: {
					method: "GET",
					path: buildPath("/v1/buy/browse/item_summary/search", { q: canonical, limit: 50 }),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchActiveListings({ q: canonical, limit: 50 }, { apiKey });
				const items = r.body.itemSummaries ?? [];
				return {
					value: { items, source: r.source as TransportSource },
					result: { count: items.length, items },
					source: r.source as TransportSource,
				};
			},
		),
	]);

	// Merge step-01 slice (already partition-validated) with the fresh
	// per-cluster active pull, dedupe by itemId. Slice goes first so it
	// stays even if the fresh search misses it under a different query.
	const seenIds = new Set<string>();
	const mergedActive: ItemSummary[] = [];
	for (const it of variant.items) {
		if (it.itemId && !seenIds.has(it.itemId)) {
			seenIds.add(it.itemId);
			mergedActive.push(it);
		}
	}
	for (const it of freshActive.items) {
		if (it.itemId && !seenIds.has(it.itemId)) {
			seenIds.add(it.itemId);
			mergedActive.push(it);
		}
	}

	// 07. matchFilter — sold + merged active culled against rep in one
	// matchPool call. Slice items re-validate against rep (partition
	// seeded with whatever was first in the bucket, not the cheapest);
	// the (seed, cand) decision cache absorbs warm pairs.
	const filtered: MatchFilterResult = await withStep(
		{ key: `filter.${idx}`, parent: "filter", label: canonical, onStep, cancelCheck },
		async () => {
			const result = await runMatchFilter(repDetail, sold.items, mergedActive, apiKey);
			return {
				value: result,
				result: {
					llmRan: result.llmRan,
					soldKept: result.matchedSold.length,
					soldRejected: result.rejectedSold.length,
					activeKept: result.matchedActive.length,
					activeRejected: result.rejectedActive.length,
				},
			};
		},
	);

	// 0 matched-sold is a normal variant outcome, not a failure — it
	// produces a `nObservations: 0` cluster the UI can label "no recent
	// sales". Mirrors the same decision in `run.ts` for /v1/evaluate.

	// 08. evaluate — same primitive `/v1/evaluate` uses. Score the rep
	// against the matched sold pool + matched active pool.
	const enrichedSold = await enrichWithDuration(filtered.matchedSold);
	const enrichedAsks = await enrichWithDuration(filtered.matchedActive);
	const { evaluation, market } = await withStep(
		{ key: `evaluate.${idx}`, parent: "evaluate", label: canonical, onStep, cancelCheck },
		async () => {
			const ev = await evaluateWithContext(repDetail, {
				...opts,
				sold: enrichedSold,
				asks: enrichedAsks,
			});
			const m = marketFromSold(
				enrichedSold,
				{ keyword: canonical, marketplace: "EBAY_US", windowDays: lookbackDays },
				undefined,
				enrichedAsks,
			) as unknown as MarketStats;
			return { value: { evaluation: ev, market: m }, result: { evaluation: ev, market: m } };
		},
	);

	const meta: EvaluateMeta = {
		itemSource: detail.source,
		soldCount: enrichedSold.length,
		soldSource: sold.source,
		activeCount: enrichedAsks.length,
		activeSource: freshActive.source,
		soldKept: enrichedSold.length,
		soldRejected: filtered.rejectedSold.length,
		activeKept: enrichedAsks.length,
		activeRejected: filtered.rejectedActive.length,
	};

	const cluster: DealCluster = {
		canonical,
		source: variant.source,
		count: enrichedAsks.length,
		item: repDetail,
		soldPool: enrichedSold,
		activePool: enrichedAsks,
		rejectedSoldPool: filtered.rejectedSold,
		rejectedActivePool: filtered.rejectedActive,
		market,
		evaluation,
		returns: extractReturns(repDetail),
		meta,
	};

	// Emit cluster.ready immediately so the UI can fill in this row
	// while other variant clusters are still computing.
	onStep?.({ kind: "cluster.ready", idx, cluster });

	return cluster;
}
