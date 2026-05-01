/**
 * Regression suite for `/v1/discover` per-cluster fan-out:
 *
 *  - Sold-search must use the cluster's canonical (cleanest) title, not
 *    the cheapest rep's raw title — rep is often a spammy listing whose
 *    title shrinks sold recall to listings sharing the spam tokens.
 *
 *  - Active-search must run per-cluster in addition to step 01's broad
 *    pull, also using canonical, so the asks distribution feeding step
 *    08's evaluate matches the size /v1/evaluate would see for the same
 *    SKU. Result is merged with step 01's slice and deduped by itemId.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { describe, expect, it, vi } from "vitest";

const SPAM_TITLE = "🔥 CANON 50MM F1.8 STM 🔥 NIFTY FIFTY 🔥 READ DESCRIPTION 🔥";
const CLEAN_LONGEST = "Canon EF 50mm f/1.8 STM Standard Prime Lens for Canon DSLR";
const CLEAN_SHORTER = "Canon EF 50mm f/1.8 STM Lens";
const USER_QUERY = "Canon 50mm";

const SOLD_QUERIES: string[] = [];
const ACTIVE_QUERIES: string[] = [];

vi.mock("../../../src/services/listings/search.js", () => ({
	searchActiveListings: async ({ q }: { q: string }) => {
		ACTIVE_QUERIES.push(q);
		return {
			body: {
				itemSummaries: [
					{
						itemId: "v1|REP|0",
						title: SPAM_TITLE,
						itemWebUrl: "https://www.ebay.com/itm/REP",
						price: { value: "89.00", currency: "USD" },
						epid: "EPID-50MM-STM",
					},
					{
						itemId: "v1|MID|0",
						title: CLEAN_SHORTER,
						itemWebUrl: "https://www.ebay.com/itm/MID",
						price: { value: "95.00", currency: "USD" },
						epid: "EPID-50MM-STM",
					},
					{
						itemId: "v1|HIGH|0",
						title: CLEAN_LONGEST,
						itemWebUrl: "https://www.ebay.com/itm/HIGH",
						price: { value: "110.00", currency: "USD" },
						epid: "EPID-50MM-STM",
					},
				] satisfies ItemSummary[],
				total: 3,
			},
			source: "scrape",
		};
	},
}));

vi.mock("../../../src/services/listings/sold.js", () => ({
	searchSoldListings: async ({ q }: { q: string }) => {
		SOLD_QUERIES.push(q);
		return { body: { itemSales: [], itemSummaries: [] }, source: "scrape" };
	},
}));

vi.mock("../../../src/services/listings/detail.js", () => ({
	getItemDetail: async (legacyId: string) => ({
		body: {
			itemId: `v1|${legacyId}|0`,
			title: SPAM_TITLE, // detail title for the rep — the spammy one
			itemWebUrl: `https://www.ebay.com/itm/${legacyId}`,
			price: { value: "89.00", currency: "USD" },
			image: { imageUrl: "https://i.ebayimg.com/main.jpg" },
		} satisfies ItemDetail,
		source: "scrape",
	}),
	detailFetcherFor: () => async () => null,
	getItemDetailFromSummary: async () => null,
}));

vi.mock("../../../src/services/match/partition-by-variant.js", () => ({
	partitionByVariant: async (items: ReadonlyArray<ItemSummary>) => [Array.from(items)],
}));

vi.mock("../../../src/services/evaluate/pipeline.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../../../src/services/evaluate/pipeline.js")>();
	return {
		...mod,
		// Pass-through matcher so the test can observe the pool that
		// reached the filter step exactly. Real callers run the LLM.
		runMatchFilter: async (
			_seed: ItemSummary,
			sold: ReadonlyArray<ItemSummary>,
			active: ReadonlyArray<ItemSummary>,
		) => ({
			matchedSold: [...sold],
			matchedActive: [...active],
			rejectedSold: [],
			rejectedActive: [],
			llmRan: false,
		}),
	};
});

const { runDiscoverPipeline } = await import("../../../src/services/evaluate/run-discover.js");

function resetCalls() {
	SOLD_QUERIES.length = 0;
	ACTIVE_QUERIES.length = 0;
}

describe("runDiscoverPipeline — per-cluster sold/active fan-out", () => {
	it("queries sold-search with the cluster's canonical title, not the cheapest rep's spammy title", async () => {
		resetCalls();
		const out = await runDiscoverPipeline({ q: USER_QUERY });

		expect(SOLD_QUERIES.length).toBe(1); // K=1 cluster, one sold call
		const q = SOLD_QUERIES[0]!;

		expect(q).not.toBe(SPAM_TITLE);
		expect(q).not.toContain("🔥");
		expect(q).not.toContain("READ DESCRIPTION");
		expect(q).not.toContain("NIFTY FIFTY");

		expect(out.clusters.length).toBe(1);
		expect(q).toBe(out.clusters[0]!.canonical);
		// `pickCanonical` favours the cleanest, longest title — CLEAN_LONGEST
		// wins over CLEAN_SHORTER on the length bonus, and over SPAM_TITLE
		// on emoji + caps + "READ DESCRIPTION" penalties.
		expect(q).toBe(CLEAN_LONGEST);
	});

	it("runs an additional active-search per cluster using canonical, not the user's broad query", async () => {
		resetCalls();
		const out = await runDiscoverPipeline({ q: USER_QUERY });

		// Step 01 broad search + one per-cluster active fan-out for K=1.
		expect(ACTIVE_QUERIES.length).toBe(2);
		expect(ACTIVE_QUERIES[0]).toBe(USER_QUERY); // step 01 echoes the user's q
		expect(ACTIVE_QUERIES[1]).toBe(CLEAN_LONGEST); // per-cluster uses canonical

		// activeSource was null pre-fanout; should now reflect the
		// transport that served the per-cluster active call.
		expect(out.clusters[0]!.meta.activeSource).toBe("scrape");
	});

	it("merges step-01 slice with the fresh per-cluster active pull, deduped by itemId", async () => {
		resetCalls();
		const out = await runDiscoverPipeline({ q: USER_QUERY });

		// Step 01 returns REP/MID/HIGH; the per-cluster active fetch (mock)
		// returns the same three. Merge + dedupe → still three. The
		// pass-through matcher preserves them all.
		const ids = out.clusters[0]!.activePool.map((a) => a.itemId).sort();
		expect(ids).toEqual(["v1|HIGH|0", "v1|MID|0", "v1|REP|0"]);
		expect(out.clusters[0]!.count).toBe(3);
	});
});
