/**
 * Variant partition over a same-canonical bucket.
 *
 * Discover's deterministic clusterer (epid → gtin → singletons) groups
 * listings that share a catalog id, but the same epid/gtin can mix
 * conditions and other variant axes (Pre-owned vs New, 36 mm vs 38 mm,
 * raw vs PSA-graded). The price + sold market for those variants are
 * different — treating them as one cluster gives the user a single
 * average and a single recommended exit that doesn't fit either side.
 *
 * `partitionByVariant` splits a bucket of N items into K equivalence
 * classes where every member is the same product *at the same variant
 * tier* — exactly the granularity `/v1/evaluate` analyses. Generic by
 * design: it doesn't enumerate axes (condition, size, year, …); the
 * underlying LLM matcher reads title + structured aspects + condition
 * + price + image + GTIN and decides "would a buyer expecting this
 * accept that as a substitute?" — the same call Evaluate's filter
 * pass uses, here aimed inward at the bucket.
 *
 * Implementation: iterate. Pick the first un-clustered item as a seed,
 * call the existing `matchPool` to filter the rest, fold seed + matched
 * into one variant cluster, recurse on the rejected. Each iteration
 * pays one `matchPool` (memoised by the 30-day decision cache + the
 * 2h response cache, so warm pairs cost ~zero). On a typical bucket of
 * 5–30 listings the partition completes in 2–4 LLM rounds.
 *
 * Falls back to a single all-in-one variant cluster when the LLM is
 * unavailable — same graceful-degrade path the matcher itself takes,
 * keeps composite endpoints up on self-host without an LLM key.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import type { ApiKey } from "../../db/schema.js";
import { detailFetcherFor } from "../listings/detail.js";
import { MatchUnavailableError, matchPool } from "./index.js";
import type { MatchOptions } from "./types.js";

/**
 * Group `items` into variant clusters. Each output array is one
 * equivalence class — the items in it are interchangeable (same
 * product, same variant tier).
 *
 * Iteration order is preserved as much as possible: items appearing
 * earlier in the input are placed earlier in the output. The caller
 * picks a representative per cluster (typically the cheapest active
 * listing) downstream.
 */
export async function partitionByVariant(
	items: ReadonlyArray<ItemSummary>,
	apiKey: ApiKey | undefined,
	options: MatchOptions = {},
): Promise<ItemSummary[][]> {
	if (items.length <= 1) return items.length === 0 ? [] : [[items[0]!]];

	const fetcher = detailFetcherFor(apiKey);
	const remaining: ItemSummary[] = [...items];
	const clusters: ItemSummary[][] = [];

	while (remaining.length > 0) {
		const seed = remaining.shift()!;
		if (remaining.length === 0) {
			clusters.push([seed]);
			break;
		}

		try {
			const result = await matchPool(seed, remaining, options, fetcher);
			const matchedIds = new Set(result.body.match.map((m) => m.item.itemId));
			const cluster: ItemSummary[] = [seed];
			const rejects: ItemSummary[] = [];
			for (const item of remaining) {
				if (matchedIds.has(item.itemId)) cluster.push(item);
				else rejects.push(item);
			}
			clusters.push(cluster);
			remaining.length = 0;
			remaining.push(...rejects);
		} catch (err) {
			if (!(err instanceof MatchUnavailableError)) throw err;
			// LLM unavailable — fall back to one cluster covering the seed
			// + all remaining items. Mirrors `runMatchFilter`'s graceful
			// degrade so composite endpoints stay up on self-host without
			// an LLM key, just at the prior coarseness (one cluster per
			// epid/gtin, conditions mixed).
			clusters.push([seed, ...remaining]);
			remaining.length = 0;
			break;
		}
	}

	return clusters;
}
