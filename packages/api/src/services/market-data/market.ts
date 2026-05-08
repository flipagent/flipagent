/**
 * Cross-marketplace MarketView pipeline. Takes a resolved
 * `(product, variant, anchorDetail)` triple — the catalog has already
 * decided which canonical SKU we're computing about — and runs:
 *
 *   1. parallel sold + active marketplace search, seeded from the
 *      anchor's title + condition tier
 *   2. LLM same-product filter against the anchor (per-marketplace
 *      pool cleanup)
 *   3. suspicious-comp partition
 *   4. headline digest + byCondition slices
 *
 * Result is the `MarketView` (typed in `@flipagent/types`). The cache
 * is product-keyed (cross-listing dedup is real here — two eBay
 * listings of the same SKU resolve to the same product → same cache).
 *
 * Buy-decision scoring is NOT in scope — `services/evaluate/judge.ts`
 * (former score.ts) lays its own layer on top using the candidate
 * listing's seller signals + buy price.
 */

import type { EvaluatePartial } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
	type ApiKey,
	type Product as ProductRow,
	productMarketCache,
	type ProductVariant as VariantRow,
} from "../../db/schema.js";
import { tierConditionIdsFor } from "../items/condition-tier.js";
import { searchActiveListings } from "../items/search.js";
import { searchSoldListings } from "../items/sold.js";
import { marketFromSold } from "./adapter.js";
import { buildActiveDigest, buildFilterSummary, buildSoldDigest } from "./digest.js";
import { buildPath, emitPartial, type PipelineListener, runMatchFilter, withStep } from "./pipeline.js";
import { extractReturns } from "./returns.js";
import { partitionSuspicious } from "./suspicious.js";

const MARKET_DATA_TTL_MS = 12 * 60 * 60_000;

const LABELS = {
	"search.sold": "Recent sales",
	"search.active": "Active competition",
	filter: "Filter same product",
	cached: "Cached upstream",
} as const;

/* --------------------------------- types --------------------------------- */

export interface MarketViewInput {
	product: ProductRow;
	variant: VariantRow | null;
	anchorDetail: ItemDetail;
	marketplace: string;
	lookbackDays: number;
	soldLimit: number;
	apiKey?: ApiKey;
	jobId?: string;
	onStep?: PipelineListener;
	cancelCheck?: () => Promise<void>;
}

/** What the pipeline produces — the MarketView body shape minus envelope details. */
export interface MarketViewDigest {
	anchor: ItemSummary;
	market: unknown;
	sold: unknown;
	active: unknown;
	marketAll: unknown;
	soldAll: unknown;
	activeAll: unknown;
	byCondition: ConditionSliceRow[];
	byVariant: VariantSummaryRow[];
	listingFloor: ListingFloorOut | null;
	filter: unknown;
	returns: unknown;
	meta: {
		soldCount: number;
		activeCount: number;
		soldKept: number;
		soldRejected: number;
		activeKept: number;
		activeRejected: number;
	};
	matchedSold: ItemSummary[];
	matchedActive: ItemSummary[];
	/** Same as `matchedSold` but with suspicious comps INcluded. Drives the toggle-on view's evaluation + display. */
	matchedSoldAll: ItemSummary[];
	matchedActiveAll: ItemSummary[];
	rejectedSold: ItemSummary[];
	rejectedActive: ItemSummary[];
	rejectionReasons: Record<string, string>;
	rejectionCategories: Record<string, string>;
	suspiciousIds: Record<string, { reason: string; pFraud: number }>;
	headlineConditionTier?: string;
}

interface ConditionSliceRow {
	conditionTier: string;
	count: number;
	market: unknown;
	sold: unknown;
	active: unknown;
}

/**
 * Sibling-variant summary. Mini-digest only (median + count + velocity)
 * — enough to render a "size 9 $a · 10 $b · 11 $c" comparison row
 * without shipping every variant's full pool. Surfaced from cache only:
 * if a sibling variant has a fresh `product_market_cache` row, we read
 * its median + count off it; if not, that variant is omitted from the
 * comparison row (no fresh fetches — keeps the call cheap and predictable).
 */
interface VariantSummaryRow {
	variantId: string;
	variantKey: string;
	attributes: Record<string, string>;
	count: number;
	medianCents: number | null;
	salesPerDay: number;
}

interface ListingFloorOut {
	listPriceCents: number;
	expectedDaysToSell: number;
	daysLow: number;
	daysHigh: number;
	queueAhead: number;
	asksAbove: number;
}

/* ----------------------------- entry point ----------------------------- */

export async function fetchMarketView(input: MarketViewInput): Promise<MarketViewDigest> {
	const { product, variant, lookbackDays, soldLimit, jobId, onStep } = input;

	// 1. Cache hit?
	const cached = await readFreshCache(product.id, variant?.id ?? null, lookbackDays, soldLimit);
	if (cached) {
		emitCachedStep(onStep, cached.expiresAt);
		return cached.digest;
	}

	// 2. Fetch upstream + cache.
	const digest = await runUpstream(input);
	await writeCache(product.id, variant?.id ?? null, lookbackDays, soldLimit, digest, jobId);
	return digest;
}

/* ------------------------------- cache ------------------------------- */

async function readFreshCache(
	productId: string,
	variantId: string | null,
	lookbackDays: number,
	soldLimit: number,
): Promise<{ digest: MarketViewDigest; expiresAt: Date } | null> {
	try {
		const variantPredicate = variantId
			? eq(productMarketCache.variantId, variantId)
			: isNull(productMarketCache.variantId);
		const rows = await db
			.select()
			.from(productMarketCache)
			.where(
				and(
					eq(productMarketCache.productId, productId),
					variantPredicate,
					eq(productMarketCache.lookbackDays, lookbackDays),
					eq(productMarketCache.soldLimit, soldLimit),
					gt(productMarketCache.expiresAt, new Date()),
				),
			)
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return { digest: row.digest as MarketViewDigest, expiresAt: row.expiresAt };
	} catch (err) {
		console.warn("[market-data] cache read failed; falling through:", (err as Error).message);
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

async function writeCache(
	productId: string,
	variantId: string | null,
	lookbackDays: number,
	soldLimit: number,
	digest: MarketViewDigest,
	sourceJobId: string | undefined,
): Promise<void> {
	try {
		const expiresAt = new Date(Date.now() + MARKET_DATA_TTL_MS);
		// Emulate UPSERT — partial unique indexes don't accept onConflict
		// targets cleanly, so we DELETE-then-INSERT when expired data
		// might exist. Stale rows are reaped by the maintenance sweep
		// (TTL) so this is rare and cheap.
		const variantPredicate = variantId
			? eq(productMarketCache.variantId, variantId)
			: isNull(productMarketCache.variantId);
		await db
			.delete(productMarketCache)
			.where(
				and(
					eq(productMarketCache.productId, productId),
					variantPredicate,
					eq(productMarketCache.lookbackDays, lookbackDays),
					eq(productMarketCache.soldLimit, soldLimit),
				),
			);
		await db.insert(productMarketCache).values({
			productId,
			variantId,
			lookbackDays,
			soldLimit,
			digest: digest as object,
			sourceJobId: sourceJobId ?? null,
			expiresAt,
		});
	} catch (err) {
		console.warn("[market-data] cache write failed; result still returned:", (err as Error).message);
	}
}

/* ------------------------------- pipeline ------------------------------- */

async function runUpstream(input: MarketViewInput): Promise<MarketViewDigest> {
	const { anchorDetail, lookbackDays, soldLimit, apiKey, onStep, cancelCheck } = input;

	const returnsValue = extractReturns(anchorDetail);
	emitPartial(onStep, {
		anchor: anchorDetail as EvaluatePartial["anchor"],
		returns: returnsValue,
	});

	const q = anchorDetail.title.trim();
	const DAY_MS = 86_400_000;
	const sinceMs = Math.floor(Date.now() / DAY_MS) * DAY_MS - lookbackDays * DAY_MS;
	const since = new Date(sinceMs).toISOString();
	const lookbackFilter = `lastSoldDate:[${since}..]`;
	const candidateConditionIds = tierConditionIdsFor((anchorDetail as { conditionId?: string }).conditionId);
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
					path: buildPath("/v1/items/search?status=sold", { q, limit: soldLimit, filter: soldFilter }),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchSoldListings({ q, limit: soldLimit, filter: soldFilter }, { apiKey });
				const items = r.body.itemSales ?? r.body.itemSummaries ?? [];
				emitPartial(onStep, { soldPool: items });
				return { value: { items, source: r.source }, result: { count: items.length }, source: r.source };
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
				return { value: { items, source: r.source }, result: { count: items.length }, source: r.source };
			},
		),
	]);
	const searchDurationMs = Math.round(performance.now() - searchStart);
	for (const settled of [soldSettled, activeSettled] as const) {
		if (settled.status === "rejected") {
			const message = String((settled.reason as Error)?.message ?? settled.reason);
			onStep?.({ kind: "failed", key: "search", error: message, durationMs: searchDurationMs });
			throw settled.reason;
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

	// Preliminary digest pre-filter.
	const prelimMarket = marketFromSold(soldPool, { windowDays: lookbackDays }, undefined, activePool, anchorDetail);
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

	// LLM same-product filter.
	const filtered = await withStep({ key: "filter", label: LABELS.filter, onStep, cancelCheck }, async () => {
		const f = await runMatchFilter(
			anchorDetail as ItemSummary,
			soldPool,
			activePool,
			apiKey,
			undefined,
			{ seed: null, sold: soldSource, active: activeSource },
			(progress) => emitPartial(onStep, { filterProgress: progress }),
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

	const { suspiciousIds, cleanSold, cleanActive } = partitionSuspicious(filtered.matchedSold, filtered.matchedActive);

	// Headline digest (clean — suspicious excluded).
	const market = marketFromSold(cleanSold, { windowDays: lookbackDays }, undefined, cleanActive, anchorDetail);
	const sold = buildSoldDigest(
		cleanSold,
		(market as { windowDays: number }).windowDays,
		(market as { salesPerDay: number }).salesPerDay,
		(market as { meanDaysToSell: number | null }).meanDaysToSell ?? null,
	);
	const active = buildActiveDigest(cleanActive);

	// Toggle view (suspicious included).
	const marketAll = marketFromSold(
		filtered.matchedSold,
		{ windowDays: lookbackDays },
		undefined,
		filtered.matchedActive,
		anchorDetail,
	);
	const soldAll = buildSoldDigest(
		filtered.matchedSold,
		(marketAll as { windowDays: number }).windowDays,
		(marketAll as { salesPerDay: number }).salesPerDay,
		(marketAll as { meanDaysToSell: number | null }).meanDaysToSell ?? null,
	);
	const activeAll = buildActiveDigest(filtered.matchedActive);

	// byCondition slicing — group cleanSold + cleanActive by condition tier.
	const byCondition = buildConditionSlices(cleanSold, cleanActive, lookbackDays, anchorDetail);

	// byVariant slicing — surface other variants of the same product
	// from cache. Fresh-fetch-free: if a sibling variant has a recent
	// product_market_cache row, we read its median+count off it. UI
	// renders "size 9 · 10 · 11" comparison without paying for every
	// variant's full run.
	const byVariant = await collectVariantSummaries(
		input.product.id,
		input.variant?.id ?? null,
		lookbackDays,
		soldLimit,
	);

	// listingFloor — pure queue model output, no buy-decision math.
	const listingFloor = computeListingFloor(market, cleanActive);

	const filter = buildFilterSummary(
		filtered.matchedSold.length,
		filtered.rejectedSold.length,
		filtered.matchedActive.length,
		filtered.rejectedActive.length,
		filtered.rejectionReasons,
		filtered.rejectionCategories,
	);
	const meta = {
		soldCount: cleanSold.length,
		activeCount: cleanActive.length,
		soldKept: filtered.matchedSold.length,
		soldRejected: filtered.rejectedSold.length,
		activeKept: filtered.matchedActive.length,
		activeRejected: filtered.rejectedActive.length,
	};

	const headlineConditionTier = (anchorDetail as { conditionId?: string }).conditionId
		? normalizeConditionTier(anchorDetail)
		: undefined;

	const digest: MarketViewDigest = {
		anchor: anchorDetail as ItemSummary,
		market,
		sold,
		active,
		marketAll,
		soldAll,
		activeAll,
		byCondition,
		byVariant,
		listingFloor,
		filter,
		returns: returnsValue,
		meta,
		matchedSold: cleanSold,
		matchedActive: cleanActive,
		matchedSoldAll: filtered.matchedSold,
		matchedActiveAll: filtered.matchedActive,
		rejectedSold: filtered.rejectedSold,
		rejectedActive: filtered.rejectedActive,
		rejectionReasons: filtered.rejectionReasons,
		rejectionCategories: filtered.rejectionCategories,
		suspiciousIds,
		...(headlineConditionTier ? { headlineConditionTier } : {}),
	};

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
		suspiciousIds,
		marketAll: marketAll as EvaluatePartial["market"],
		soldAll,
		activeAll,
		preliminary: false,
	});

	return digest;
}

/* ----------------------------- slicing ----------------------------- */

/**
 * Group sold + active pools by condition tier and run the same digest
 * builders per slice. Slice keys come from `normalizeConditionTier` so
 * graded-card categories use grade keys (`graded:psa_9`) while normal
 * categories use eBay's condition string lower-cased.
 */
function buildConditionSlices(
	sold: ReadonlyArray<ItemSummary>,
	active: ReadonlyArray<ItemSummary>,
	lookbackDays: number,
	anchor: ItemDetail,
): ConditionSliceRow[] {
	const buckets = new Map<string, { sold: ItemSummary[]; active: ItemSummary[] }>();
	for (const it of sold) {
		const key = normalizeConditionTier(it);
		if (!key) continue;
		let b = buckets.get(key);
		if (!b) {
			b = { sold: [], active: [] };
			buckets.set(key, b);
		}
		b.sold.push(it);
	}
	for (const it of active) {
		const key = normalizeConditionTier(it);
		if (!key) continue;
		let b = buckets.get(key);
		if (!b) {
			b = { sold: [], active: [] };
			buckets.set(key, b);
		}
		b.active.push(it);
	}
	const out: ConditionSliceRow[] = [];
	for (const [conditionTier, bucket] of buckets) {
		const m = marketFromSold(bucket.sold, { windowDays: lookbackDays }, undefined, bucket.active, anchor);
		const s = buildSoldDigest(
			bucket.sold,
			(m as { windowDays: number }).windowDays,
			(m as { salesPerDay: number }).salesPerDay,
			(m as { meanDaysToSell: number | null }).meanDaysToSell ?? null,
		);
		const a = buildActiveDigest(bucket.active);
		out.push({
			conditionTier,
			count: bucket.sold.length + bucket.active.length,
			market: m,
			sold: s,
			active: a,
		});
	}
	// Stable order by count desc.
	out.sort((x, y) => y.count - x.count);
	return out;
}

/**
 * Map a listing's condition signal to a stable slice key.
 *
 * Default path: lower-case the eBay condition string (`Used`, `New`,
 * `Used - Like New`).
 *
 * Graded-card extension: when the listing carries `conditionDescriptors`
 * with a recognised grader (PSA / BGS / CGC / SGC), prefix `graded:` +
 * grader_grade. Two PSA-9 + PSA-10 cards land in different slices even
 * though both have eBay condition `Used`.
 */
function normalizeConditionTier(it: {
	condition?: string;
	conditionId?: string;
	conditionDescriptors?: unknown;
}): string {
	const descriptors = it.conditionDescriptors;
	if (Array.isArray(descriptors)) {
		for (const d of descriptors as Array<{ name?: string; values?: Array<{ content?: string }> }>) {
			const name = (d.name ?? "").trim().toUpperCase();
			if (!name) continue;
			if (name === "PROFESSIONAL GRADER" || name === "GRADER") {
				const grader = d.values?.[0]?.content?.trim().toLowerCase();
				if (grader) {
					// look ahead for grade
					for (const d2 of descriptors as Array<{ name?: string; values?: Array<{ content?: string }> }>) {
						const n2 = (d2.name ?? "").trim().toUpperCase();
						if (n2 === "GRADE" || n2 === "NUMBER GRADE") {
							const g = d2.values?.[0]?.content?.trim();
							if (g) return `graded:${grader}_${g.toLowerCase()}`;
						}
					}
					return `graded:${grader}`;
				}
			}
		}
	}
	const cond = it.condition?.trim();
	if (cond)
		return cond
			.toLowerCase()
			.replace(/\s+/g, "_")
			.replace(/[^a-z0-9_]/g, "");
	return "unknown";
}

/* ---------------------------- byVariant ---------------------------- */

import { productVariants } from "../../db/schema.js";

/**
 * Cache-only sibling-variant rollup. For each variant of the product
 * (excluding the focal `focalVariantId` so it doesn't double-count
 * against the headline), we look up `product_market_cache` for a fresh
 * `(productId, variantId, lookbackDays, soldLimit)` row. Hits become
 * `VariantSummaryRow` entries; misses are silently dropped. UI renders
 * what's known; agents can drive a fresh appraise per variant if they
 * want full coverage.
 */
async function collectVariantSummaries(
	productId: string,
	focalVariantId: string | null,
	lookbackDays: number,
	soldLimit: number,
): Promise<VariantSummaryRow[]> {
	try {
		const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
		if (variants.length === 0) return [];
		const out: VariantSummaryRow[] = [];
		// Sequential reads — variant counts are typically <50 (sneakers,
		// clothes); not worth the connection-pool churn of Promise.all
		// for tiny indexed lookups. Re-evaluate if products with 200+
		// variants become common.
		for (const v of variants) {
			if (focalVariantId && v.id === focalVariantId) continue;
			const cached = await readFreshCache(productId, v.id, lookbackDays, soldLimit);
			if (!cached) continue;
			const m = (cached.digest.market ?? {}) as { medianCents?: number; salesPerDay?: number };
			const meta = cached.digest.meta;
			out.push({
				variantId: v.id,
				variantKey: v.variantKey,
				attributes: v.attributes as Record<string, string>,
				count: meta.soldCount + meta.activeCount,
				medianCents: typeof m.medianCents === "number" && m.medianCents > 0 ? m.medianCents : null,
				salesPerDay: typeof m.salesPerDay === "number" ? m.salesPerDay : 0,
			});
		}
		// Stable order by variant_key so UIs render size 9, 10, 11 in
		// natural order (alpha-sorted matches numeric-string lexical
		// for sized SKUs once zero-padded; close enough).
		out.sort((a, b) => (a.variantKey < b.variantKey ? -1 : a.variantKey > b.variantKey ? 1 : 0));
		return out;
	} catch (err) {
		console.warn("[market-data] byVariant collect failed:", (err as Error).message);
		return [];
	}
}

/* --------------------------- listing floor --------------------------- */

import { DEFAULT_FEES, recommendListPrice } from "../quant/index.js";
import { toCents } from "../shared/money.js";

/**
 * Recommended list price + queue-model exit forecast — the market
 * answer to "if you sold this product, what should you ask + how
 * fast?". No buy-decision math (no net, no $/day). Buy-decision
 * callers compose net on top using their candidate listing's buy
 * price. Returns null when no advice could be computed.
 */
function computeListingFloor(market: unknown, cleanActive: ReadonlyArray<ItemSummary>): ListingFloorOut | null {
	const askPrices = cleanActive.map((a) => toCents(a.price?.value)).filter((p) => p > 0);
	const advice = recommendListPrice(market as Parameters<typeof recommendListPrice>[0], {
		fees: DEFAULT_FEES,
		outboundShippingCents: 0,
		activeAskPrices: askPrices,
		buyPriceCents: 0,
	});
	if (!advice) return null;
	return {
		listPriceCents: advice.listPriceCents,
		expectedDaysToSell: advice.expectedDaysToSell,
		daysLow: advice.daysLow,
		daysHigh: advice.daysHigh,
		queueAhead: advice.queueAhead,
		asksAbove: advice.asksAbove,
	};
}
