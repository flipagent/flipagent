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
 *   05 search.sold        — parent; per-cluster sold search
 *   06 filter             — parent; per-cluster same-product matcher
 *   07 evaluate           — parent; per-cluster scoring
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
import { legacyFromV1, toLegacyId } from "../../utils/item-id.js";
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

	// 04 + 05 + 06 + 07. per-variant Evaluate sub-flow (parallel) --------
	onStep?.({ kind: "started", key: "detail", label: LABELS.detail });
	onStep?.({ kind: "started", key: "search.sold", label: LABELS["search.sold"] });
	onStep?.({ kind: "started", key: "filter", label: LABELS.filter });
	onStep?.({ kind: "started", key: "evaluate", label: LABELS.evaluate });
	const detailStart = performance.now();
	const searchSoldStart = performance.now();
	const filterStart = performance.now();
	const evaluateStart = performance.now();

	const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
	const lookbackFilter = `lastSoldDate:[${since}..]`;

	const settled = await Promise.allSettled(
		variantClusters.map((vc, idx) =>
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
	);

	const successful: DealCluster[] = [];
	for (const r of settled) if (r.status === "fulfilled") successful.push(r.value);

	const detailDuration = Math.round(performance.now() - detailStart);
	const searchSoldDuration = Math.round(performance.now() - searchSoldStart);
	const filterDuration = Math.round(performance.now() - filterStart);
	const evaluateDuration = Math.round(performance.now() - evaluateStart);

	if (successful.length === 0) {
		const err = "every variant cluster's sub-flow failed";
		onStep?.({ kind: "failed", key: "detail", error: err, durationMs: detailDuration });
		onStep?.({ kind: "failed", key: "search.sold", error: err, durationMs: searchSoldDuration });
		onStep?.({ kind: "failed", key: "filter", error: err, durationMs: filterDuration });
		onStep?.({ kind: "failed", key: "evaluate", error: err, durationMs: evaluateDuration });
		throw new EvaluateError(
			"not_enough_sold",
			422,
			`Every variant cluster's per-product search returned 0 same-product sold listings, or all sub-flows failed. Try a broader query or longer lookback.`,
		);
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
		key: "filter",
		result: {
			clusters: successful.length,
			soldKept: successful.reduce((s, c) => s + c.soldPool.length, 0),
			soldRejected: successful.reduce((s, c) => s + c.rejectedSoldPool.length, 0),
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
			const legacyId = toLegacyId(rep) ?? legacyFromV1(rep.itemId);
			if (!legacyId) {
				throw new EvaluateError(
					"item_not_found",
					404,
					`Representative for "${canonical}" has no resolvable legacy id.`,
				);
			}
			const r = await getItemDetail(legacyId, { apiKey });
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

	// 05. sold search using the rep's title.
	const sold = await withStep(
		{
			key: `search.sold.${idx}`,
			parent: "search.sold",
			label: canonical,
			request: {
				method: "GET",
				path: buildPath("/v1/buy/marketplace_insights/item_sales/search", {
					q: repDetail.title,
					limit: soldLimit,
					filter: lookbackFilter,
				}),
			},
			onStep,
			cancelCheck,
		},
		async () => {
			const r = await searchSoldListings(
				{ q: repDetail.title, limit: soldLimit, filter: lookbackFilter },
				{ apiKey },
			);
			const items = r.body.itemSales ?? r.body.itemSummaries ?? [];
			return {
				value: { items, source: r.source as TransportSource },
				result: { count: items.length, items },
				source: r.source as TransportSource,
			};
		},
	);

	// 06. matchFilter — sold pool against rep. The active pool is the
	// variant cluster's items, already pre-curated by partitionByVariant
	// at step 03 so we don't run the matcher on it again.
	const filtered: MatchFilterResult = await withStep(
		{ key: `filter.${idx}`, parent: "filter", label: canonical, onStep, cancelCheck },
		async () => {
			const result = await runMatchFilter(repDetail, sold.items, [], apiKey);
			return {
				value: result,
				result: {
					llmRan: result.llmRan,
					soldKept: result.matchedSold.length,
					soldRejected: result.rejectedSold.length,
				},
			};
		},
	);

	if (filtered.matchedSold.length < 1) {
		throw new EvaluateError("not_enough_sold", 422, `Variant "${canonical}" yielded 0 same-product sold listings.`);
	}

	// 07. evaluate — same primitive `/v1/evaluate` uses. Score the rep
	// against the matched sold pool + the variant cluster's active pool.
	const enrichedSold = await enrichWithDuration(filtered.matchedSold);
	const enrichedAsks = await enrichWithDuration(variant.items);
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
		activeSource: null,
		soldKept: enrichedSold.length,
		soldRejected: filtered.rejectedSold.length,
		activeKept: enrichedAsks.length,
		activeRejected: 0,
	};

	const cluster: DealCluster = {
		canonical,
		source: variant.source,
		count: variant.items.length,
		item: repDetail,
		soldPool: enrichedSold,
		activePool: enrichedAsks,
		rejectedSoldPool: filtered.rejectedSold,
		rejectedActivePool: [],
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
