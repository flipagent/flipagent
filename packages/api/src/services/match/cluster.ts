/**
 * Same-product clustering for a heterogeneous candidate pool.
 *
 * Used by `/v1/discover` to dedupe sold-search calls when several active
 * listings refer to the same SKU — running one sold-search per cluster
 * is cheaper than per-listing when listings collapse onto a shared
 * canonical query.
 *
 * Deterministic-only flow. Two safe signals from the eBay Browse
 * summary, in order:
 *
 *   1. group by `epid`  — eBay catalog product id. Same epid = same SKU
 *                          per the eBay catalog. ~20–40% populated on a
 *                          typical search. Free, instant, exact.
 *   2. group by `gtin`  — UPC / EAN / ISBN. Same gtin = same physical
 *                          product. Falls back when the listing isn't
 *                          catalog-linked but the seller supplied a code.
 *
 * `itemGroupHref` is **deliberately not used** here even though it's a
 * deterministic same-summary signal: it groups *seller-defined variants*
 * (e.g. iPhone 128GB Natural + 256GB Blue + 512GB White all share one
 * href) which sit in different sold markets. Using it as a cluster key
 * would corrupt the sold pool with mixed-SKU listings.
 *
 * Anything left over becomes a singleton cluster — its sold-search runs
 * with the listing's own title as the query, and eBay's relevance does
 * the disambiguation. The previous LLM-based clustering of the remainder
 * was removed: on broad queries it deduped ~3 of ~50 sold-searches at a
 * 6–10s LLM cost (net latency loss) and produced non-deterministic
 * canonical names that defeated cross-request caching. Catalog-linked
 * dedup + per-listing sold-search via cache absorbs most of the savings
 * across users without the cost.
 *
 * `Cluster.canonical` is the load-bearing output — the per-cluster
 * sold-search uses it as `q=`. For grouped clusters it's the cleanest
 * title in the group; for singletons it's the listing's own title.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";

export interface Cluster {
	/** Clean SKU + key spec name, suitable as a sold-search `q=`. */
	canonical: string;
	/** Origin of the grouping decision — useful for trace UIs and debugging. */
	source: "epid" | "gtin" | "singleton";
	/** Items grouped into this product. */
	items: ItemSummary[];
}

/**
 * Cluster a candidate pool by same-product. Pure-deterministic: epid →
 * gtin → singletons. No network, no LLM, fully synchronous.
 */
export function clusterByProduct(items: ReadonlyArray<ItemSummary>): Cluster[] {
	if (items.length === 0) return [];

	const clusters: Cluster[] = [];
	const remainder = groupBy(items, (i) => i.epid, "epid", clusters);
	const remainder2 = groupBy(remainder, (i) => i.gtin, "gtin", clusters);
	for (const i of remainder2) {
		clusters.push({ canonical: i.title.trim(), source: "singleton", items: [i] });
	}
	return clusters;
}

/**
 * Bucket items by a deterministic key extractor, push grouped clusters,
 * return the items whose key was missing or empty so the caller can
 * pipe them into the next stage.
 */
function groupBy(
	items: ReadonlyArray<ItemSummary>,
	keyOf: (i: ItemSummary) => string | undefined,
	source: Exclude<Cluster["source"], "singleton">,
	out: Cluster[],
): ItemSummary[] {
	const buckets = new Map<string, ItemSummary[]>();
	const remainder: ItemSummary[] = [];
	for (const i of items) {
		const k = keyOf(i);
		if (k) {
			const arr = buckets.get(k) ?? [];
			arr.push(i);
			buckets.set(k, arr);
		} else {
			remainder.push(i);
		}
	}
	for (const arr of buckets.values()) {
		out.push({ canonical: shortestCleanTitle(arr), source, items: arr });
	}
	return remainder;
}

/**
 * Pick the cleanest title from a group of same-product listings as the
 * canonical name. Catalog-linked groups generally have consistent
 * titles, but the cleanest one (no emojis, no all-caps marketing bait)
 * makes the best sold-search query.
 */
function shortestCleanTitle(items: ReadonlyArray<ItemSummary>): string {
	let best = items[0]!.title.trim();
	let bestNoise = noiseScore(best);
	for (let i = 1; i < items.length; i++) {
		const t = items[i]!.title.trim();
		const n = noiseScore(t);
		// Lower noise wins; tie-break on shorter length (fewer extras).
		if (n < bestNoise || (n === bestNoise && t.length < best.length)) {
			best = t;
			bestNoise = n;
		}
	}
	return best;
}

/** Heuristic: count emojis + ALL-CAPS marketing words + repeated punctuation. */
function noiseScore(t: string): number {
	const emoji = (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
	const stars = (t.match(/[★⭐]/g) ?? []).length;
	const allCapsMarketing = (t.match(/\b(FAST SHIP|FREE SHIP|NEW IN BOX|NIB|AUTHENTIC|GENUINE|MINT|HOT DEAL)\b/g) ?? [])
		.length;
	const punctRuns = (t.match(/[!?]{2,}|\.{3,}/g) ?? []).length;
	return emoji + stars * 2 + allCapsMarketing + punctRuns;
}
