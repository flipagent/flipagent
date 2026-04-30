/**
 * `/v1/discover` schema — query-driven deal ranking. Overnight pillar.
 *
 * Architecture: Discover = Evaluate batched over LLM-clustered
 * candidates. The pipeline is:
 *
 *   1. active search        — broad candidate pool by query
 *   2. variant clustering   — deterministic (epid/gtin/title-singleton)
 *                             then LLM partition WITHIN each bucket so
 *                             `(canonical, condition, [size/grade/year/…])`
 *                             fall into separate clusters. Generic — no
 *                             hardcoded axes; the LLM uses whatever
 *                             distinguishing information the listings
 *                             carry. Same "would a buyer expecting X
 *                             accept Y as a substitute?" frame Evaluate's
 *                             filter pass uses, applied symmetrically.
 *   3. per-cluster Evaluate — for each variant cluster, pick the cheapest
 *                             listing as representative and run the
 *                             Evaluate pipeline against it (sold search,
 *                             same-product filter, market stats, score).
 *                             Each cluster's payload is therefore
 *                             EvaluateResponse-shape.
 *   4. rank                 — sort clusters by representative's $/day.
 *
 * UIs render one row per cluster, each row reads as a per-variant
 * Evaluate result preview. Clicking a row opens a detail pane with the
 * full Evaluate report for that variant.
 *
 * For ranking a single known listing, use `/v1/evaluate` — Discover and
 * Evaluate share the same per-product pipeline; Discover just runs it
 * K times in parallel.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemDetail, ItemSummary } from "./ebay/buy.js";
import { EvaluateMeta, EvaluateOpts, Evaluation, MarketStats, Returns, TransportSource } from "./evaluate.js";

export const DiscoverRequest = Type.Object(
	{
		/** Active-search query. eBay Browse `q=`. */
		q: Type.String({ minLength: 1 }),
		/** Optional category filter. eBay Browse `category_ids=` (single id). */
		categoryId: Type.Optional(Type.String()),
		/** Optional eBay Browse `filter=` expression (price ranges, conditionIds, itemLocationCountry, …). */
		filter: Type.Optional(Type.String()),
		/** Active candidates fetched. Default 50, max 200 (eBay Browse page cap). */
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		/**
		 * Sold-search lookback window in days. Filters the per-cluster sold
		 * pool to `lastSoldDate within [now - lookbackDays, now]`. Default
		 * 90 (Marketplace Insights' practical max). Mirrors `/v1/evaluate`.
		 */
		lookbackDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 90 })),
		/**
		 * Cap on sold-search results per cluster, before LLM same-product
		 * filtering. Default 50 — the size at which IQR + percentile
		 * estimates stabilise. Max 200 (eBay Browse page cap). Mirrors
		 * `/v1/evaluate`.
		 */
		soldLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		opts: Type.Optional(EvaluateOpts),
	},
	{ $id: "DiscoverRequest" },
);
export type DiscoverRequest = Static<typeof DiscoverRequest>;

/** Aggregate counts across all clusters. Useful for the trace ("we
 *  searched N actives, kept K, partitioned into M variants"). */
export const DiscoverMeta = Type.Object(
	{
		/** Total active candidates pulled from the broad search (pre-cluster). */
		activeCount: Type.Integer(),
		activeSource: TransportSource,
		/** Total sold listings kept across all per-cluster pools. */
		soldCount: Type.Integer(),
		soldSource: TransportSource,
		/** Total clusters the pipeline produced (one row per cluster in the UI). */
		clusterCount: Type.Integer(),
	},
	{ $id: "DiscoverMeta" },
);
export type DiscoverMeta = Static<typeof DiscoverMeta>;

/**
 * One variant cluster. Each is one same-product-same-variant group of
 * active listings — the unit at which Evaluate operates. Carries the
 * full Evaluate-shape fields for that variant: representative item +
 * sold pool + active pool + market stats + scoring + meta.
 *
 * UIs render one table row per cluster (with the representative's
 * thumbnail/title and the evaluation's Buy at / Resells at / Est.
 * profit / $/day) and an evaluate-style detail pane on row click.
 *
 * `count` (= activePool.length) is the size of the variant cluster —
 * how many duplicate active listings collapsed into this row.
 */
export const DealCluster = Type.Object(
	{
		/** Sold-search query the cluster used (= cleanest title in the variant group). */
		canonical: Type.String(),
		/**
		 * Origin of the deterministic bucket this variant cluster was
		 * partitioned out of. `epid` / `gtin` indicate a catalog-linked
		 * bucket; `singleton` covers buckets seeded by a lone listing. The
		 * variant partition itself is always LLM-driven.
		 */
		source: Type.Union([Type.Literal("epid"), Type.Literal("gtin"), Type.Literal("singleton")]),
		/** Number of active listings in this variant group (= activePool.length). */
		count: Type.Integer(),

		// --- Evaluate-shape payload for the representative ----------------
		/** Representative listing's full detail (cheapest active in the variant group). */
		item: ItemDetail,
		/** Same-product sold listings the matcher kept for this variant. */
		soldPool: Type.Array(ItemSummary),
		/** Active listings in the variant cluster — what the rep is competing against. */
		activePool: Type.Array(ItemSummary),
		/** Sold listings the same-product filter rejected. Empty when the LLM didn't run. */
		rejectedSoldPool: Type.Array(ItemSummary),
		/** Active listings the same-product filter rejected. */
		rejectedActivePool: Type.Array(ItemSummary),
		market: MarketStats,
		evaluation: Evaluation,
		returns: Type.Union([Returns, Type.Null()]),
		meta: EvaluateMeta,
	},
	{ $id: "DealCluster" },
);
export type DealCluster = Static<typeof DealCluster>;

export const DiscoverResponse = Type.Object(
	{
		/**
		 * One per same-product-same-variant group, sorted by representative's
		 * `evaluation.recommendedExit.dollarsPerDay` desc. Each cluster IS a
		 * full Evaluate result for its representative listing.
		 */
		clusters: Type.Array(DealCluster),
		meta: DiscoverMeta,
	},
	{ $id: "DiscoverResponse" },
);
export type DiscoverResponse = Static<typeof DiscoverResponse>;

/* ---------------------- compute-job shape (async mode) ---------------------- */

import { ComputeJobBase } from "./compute-jobs.js";

/**
 * `GET /v1/discover/jobs/{id}` body. `params` echoes the request that
 * created the job; `result` is present iff `status === "completed"`.
 */
export const DiscoverJob = Type.Intersect(
	[
		ComputeJobBase,
		Type.Object({
			kind: Type.Literal("discover"),
			params: DiscoverRequest,
			result: Type.Union([DiscoverResponse, Type.Null()]),
		}),
	],
	{ $id: "DiscoverJob" },
);
export type DiscoverJob = Static<typeof DiscoverJob>;
