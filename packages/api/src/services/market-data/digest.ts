/**
 * Digest builders — turn the raw same-product pools into the lean
 * shape MCP / SDK callers consume by default. The full pools stay on
 * `EvaluateResponse.{soldPool,activePool,...}` for back-compat (the
 * playground dashboard renders them); these digests are what the LLM
 * speaks in.
 *
 * Pure, stateless. All compute happens here so the pipeline file stays
 * focused on orchestration.
 */

import type {
	ActiveDigest,
	ConditionMix,
	EvaluatePoolResponse,
	EvaluationPoolItem,
	EvaluationRejectedItem,
	FilterSummary,
	PriceDistribution,
	PriceHistogramBin,
	RecentTrend,
	SoldDigest,
} from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";

/* ------------------------------ utilities ------------------------------ */

function priceCents(item: ItemSummary): number | null {
	const v = item.price?.value;
	if (typeof v !== "string" && typeof v !== "number") return null;
	const f = typeof v === "number" ? v : Number.parseFloat(v);
	if (!Number.isFinite(f)) return null;
	return Math.round(f * 100);
}

function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0]!;
	// Linear interpolation, mirrors numpy's default. Same convention
	// `services/quant/stats.ts` uses.
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo]!;
	return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo));
}

function distribution(prices: readonly number[]): PriceDistribution {
	if (prices.length === 0) {
		return { minCents: 0, p10Cents: 0, p25Cents: 0, p50Cents: 0, p75Cents: 0, p90Cents: 0, maxCents: 0 };
	}
	const sorted = [...prices].sort((a, b) => a - b);
	return {
		minCents: sorted[0]!,
		p10Cents: percentile(sorted, 0.1),
		p25Cents: percentile(sorted, 0.25),
		p50Cents: percentile(sorted, 0.5),
		p75Cents: percentile(sorted, 0.75),
		p90Cents: percentile(sorted, 0.9),
		maxCents: sorted[sorted.length - 1]!,
	};
}

const HIST_BINS = 10;

function histogram(prices: readonly number[], dist: PriceDistribution): PriceHistogramBin[] {
	if (prices.length === 0 || dist.maxCents === dist.minCents) {
		return prices.length === 0 ? [] : [{ minCents: dist.minCents, maxCents: dist.maxCents, count: prices.length }];
	}
	const span = dist.maxCents - dist.minCents;
	const step = Math.max(1, Math.ceil(span / HIST_BINS));
	const bins: PriceHistogramBin[] = [];
	for (let i = 0; i < HIST_BINS; i++) {
		const lo = dist.minCents + step * i;
		const hi = i === HIST_BINS - 1 ? dist.maxCents : dist.minCents + step * (i + 1);
		bins.push({ minCents: lo, maxCents: hi, count: 0 });
	}
	for (const p of prices) {
		// Final bin is inclusive on both ends so the maximum value lands.
		let idx = Math.min(HIST_BINS - 1, Math.floor((p - dist.minCents) / step));
		if (idx < 0) idx = 0;
		bins[idx]!.count += 1;
	}
	return bins;
}

function conditionMix(items: readonly ItemSummary[]): ConditionMix {
	if (items.length === 0) return {};
	const counts: Record<string, number> = {};
	for (const it of items) {
		const slug = (it.condition ?? "unknown").toString().toLowerCase().replace(/\s+/g, "_");
		counts[slug] = (counts[slug] ?? 0) + 1;
	}
	const total = items.length;
	const out: ConditionMix = {};
	for (const [k, v] of Object.entries(counts)) out[k] = Number((v / total).toFixed(3));
	return out;
}

/* ------------------------------ recent trend ------------------------------ */

/**
 * The same-product filter feeds us `ItemSummary` rows from the sold
 * search. The eBay-shape sold timestamp lives on `lastSoldDate`
 * (`@flipagent/types/ebay/buy`), not `soldAt` — that mistake silently
 * killed the recent-trend signal and the lastSale anchor in the digest.
 */
function soldAtMs(item: ItemSummary): number | null {
	const v = item.lastSoldDate ?? null;
	if (!v) return null;
	const t = Date.parse(v);
	return Number.isFinite(t) ? t : null;
}

function soldPriceCents(item: ItemSummary): number | null {
	// Prefer the canonical sold price; fall back to the listed price for
	// rows where the upstream only carried `price`.
	const v = item.lastSoldPrice?.value ?? item.price?.value;
	if (typeof v !== "string" && typeof v !== "number") return null;
	const f = typeof v === "number" ? v : Number.parseFloat(v);
	if (!Number.isFinite(f)) return null;
	return Math.round(f * 100);
}

function recentTrend(sold: readonly ItemSummary[]): RecentTrend | null {
	const now = Date.now();
	const cutoff = now - 14 * 24 * 60 * 60 * 1000;
	const priorCutoff = now - 28 * 24 * 60 * 60 * 1000;
	const recent: number[] = [];
	const prior: number[] = [];
	for (const it of sold) {
		const t = soldAtMs(it);
		const c = soldPriceCents(it);
		if (t == null || c == null) continue;
		if (t >= cutoff) recent.push(c);
		else if (t >= priorCutoff) prior.push(c);
	}
	if (recent.length < 4 || prior.length < 4) return null;
	const recentMed = percentile(
		[...recent].sort((a, b) => a - b),
		0.5,
	);
	const priorMed = percentile(
		[...prior].sort((a, b) => a - b),
		0.5,
	);
	if (priorMed === 0) return null;
	const change = ((recentMed - priorMed) / priorMed) * 100;
	let direction: "up" | "flat" | "down" = "flat";
	if (change > 3) direction = "up";
	else if (change < -3) direction = "down";
	return { direction, change14dPct: Number(change.toFixed(1)) };
}

function lastSale(sold: readonly ItemSummary[]): { lastSaleAt: string | null; lastSalePriceCents: number | null } {
	let bestT = -Infinity;
	let bestAt: string | null = null;
	let bestPrice: number | null = null;
	for (const it of sold) {
		const t = soldAtMs(it);
		const c = soldPriceCents(it);
		if (t == null || c == null) continue;
		if (t > bestT) {
			bestT = t;
			bestAt = it.lastSoldDate ?? null;
			bestPrice = c;
		}
	}
	return { lastSaleAt: bestAt, lastSalePriceCents: bestPrice };
}

/* --------------------------- seller concentration --------------------------- */

function sellerConcentration(items: readonly ItemSummary[]): "diverse" | "few_sellers" {
	if (items.length < 4) return "diverse";
	const counts: Record<string, number> = {};
	for (const it of items) {
		const seller = (it as { seller?: { username?: string } }).seller?.username ?? "anonymous";
		counts[seller] = (counts[seller] ?? 0) + 1;
	}
	const sorted = Object.values(counts).sort((a, b) => b - a);
	const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
	return top3 / items.length > 0.5 ? "few_sellers" : "diverse";
}

/* ----------------------------- digest builders ----------------------------- */

export function buildSoldDigest(
	sold: readonly ItemSummary[],
	windowDays: number,
	salesPerDay: number,
	meanDaysToSell: number | null,
): SoldDigest {
	const prices = sold.map(priceCents).filter((p): p is number => p != null);
	const dist = distribution(prices);
	const last = lastSale(sold);
	return {
		count: sold.length,
		windowDays,
		salesPerDay,
		meanDaysToSell,
		priceCents: dist,
		priceHistogram: histogram(prices, dist),
		conditionMix: conditionMix(sold),
		recentTrend: recentTrend(sold),
		lastSaleAt: last.lastSaleAt,
		lastSalePriceCents: last.lastSalePriceCents,
	};
}

export function buildActiveDigest(active: readonly ItemSummary[]): ActiveDigest {
	const prices = active.map(priceCents).filter((p): p is number => p != null);
	const dist = distribution(prices);
	return {
		count: active.length,
		priceCents: dist,
		priceHistogram: histogram(prices, dist),
		conditionMix: conditionMix(active),
		bestPriceCents: prices.length === 0 ? null : Math.min(...prices),
		sellerConcentration: sellerConcentration(active),
	};
}

/* ----------------------- rejection categorization ----------------------- */

const VALID_CATS: ReadonlySet<string> = new Set(["wrong_product", "bundle_or_lot", "off_condition", "other"]);

/**
 * The LLM matcher emits a `category` per rejected listing — that's the
 * source of truth and we trust it. This regex fallback only fires for
 * the rare case where the cached decision predates the category field
 * (no category persisted) or a malformed LLM response slipped through
 * coercion. New rejections always land here as `other` at worst.
 */
const CAT_PATTERNS: ReadonlyArray<{ category: string; rx: RegExp }> = [
	// Bundle / lot first — a "bundle of damaged" should bucket as bundle, not condition.
	{
		category: "bundle_or_lot",
		rx: /\b(bundle|lot of|set of|pair|kit|multi-?pack|x\s?\d+\s|qty\s*\d+|with extras?|with .* (and|plus))\b/i,
	},
	{
		category: "off_condition",
		rx: /\b(broken|damaged|cracked|parts? only|for parts|not working|defective|untested|as[- ]is|missing|incomplete)\b/i,
	},
	{
		category: "wrong_product",
		rx: /\b(different|wrong|incompatible|other|not the same|distinct|mismatch|actually|appears to be|is a |is the |EF-?S?(\b|\s)|f\/?\d|mm\b)\b/i,
	},
];

function categorizeReason(reason: string): string {
	for (const { category, rx } of CAT_PATTERNS) {
		if (rx.test(reason)) return category;
	}
	return "other";
}

export function buildFilterSummary(
	soldKept: number,
	soldRejected: number,
	activeKept: number,
	activeRejected: number,
	rejectionReasons: Record<string, string>,
	rejectionCategories: Record<string, string> = {},
): FilterSummary {
	const rejectionsByCategory: Record<string, number> = {};
	for (const itemId of Object.keys(rejectionReasons)) {
		const llmCat = rejectionCategories[itemId];
		const cat = llmCat && VALID_CATS.has(llmCat) ? llmCat : categorizeReason(rejectionReasons[itemId] ?? "");
		rejectionsByCategory[cat] = (rejectionsByCategory[cat] ?? 0) + 1;
	}
	return { soldKept, soldRejected, activeKept, activeRejected, rejectionsByCategory };
}

/* --------------------------- pool drill-down --------------------------- */

function poolItem(it: ItemSummary): EvaluationPoolItem {
	const c = soldPriceCents(it) ?? 0;
	return {
		itemId: it.itemId,
		title: it.title ?? "",
		priceCents: c,
		currency: it.price?.currency ?? it.lastSoldPrice?.currency ?? "USD",
		condition: it.condition ?? undefined,
		sellerLogin: it.seller?.username,
		itemWebUrl: it.itemWebUrl,
		soldAt: it.lastSoldDate,
		listedAt: it.itemCreationDate,
	};
}

function rejectedItem(
	it: ItemSummary,
	reasons: Record<string, string>,
	categories: Record<string, string>,
): EvaluationRejectedItem {
	const c = soldPriceCents(it) ?? 0;
	const reason = reasons[it.itemId] ?? "Filtered as not the same product.";
	const llmCat = categories[it.itemId];
	const category = llmCat && VALID_CATS.has(llmCat) ? llmCat : categorizeReason(reason);
	return {
		itemId: it.itemId,
		title: it.title ?? "",
		priceCents: c,
		currency: it.price?.currency ?? it.lastSoldPrice?.currency ?? "USD",
		condition: it.condition ?? undefined,
		sellerLogin: it.seller?.username,
		itemWebUrl: it.itemWebUrl,
		rejectionReason: reason,
		rejectionCategory: category,
	};
}

export function buildPoolResponse(args: {
	itemId: string;
	evaluatedAt: string;
	soldKept: readonly ItemSummary[];
	soldRejected: readonly ItemSummary[];
	activeKept: readonly ItemSummary[];
	activeRejected: readonly ItemSummary[];
	rejectionReasons: Record<string, string>;
	rejectionCategories?: Record<string, string>;
}): EvaluatePoolResponse {
	const cats = args.rejectionCategories ?? {};
	return {
		itemId: args.itemId,
		evaluatedAt: args.evaluatedAt,
		sold: {
			kept: args.soldKept.map(poolItem),
			rejected: args.soldRejected.map((it) => rejectedItem(it, args.rejectionReasons, cats)),
		},
		active: {
			kept: args.activeKept.map(poolItem),
			rejected: args.activeRejected.map((it) => rejectedItem(it, args.rejectionReasons, cats)),
		},
	};
}
