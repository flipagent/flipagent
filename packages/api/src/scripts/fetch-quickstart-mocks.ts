/**
 * One-shot: pull real listings + sold-pool data for every QUICKSTART
 * preset shown to logged-out visitors in the landing-hero playground,
 * download each image, and emit a single `fixtures.json` blob ready to
 * paste into `apps/docs/src/components/playground/mockData.ts`.
 *
 * Four presets:
 *   discover/watches        q="watch" cat=31387 priceMax=300
 *   discover/charizard      q="charizard 1st edition" cat=183454
 *   evaluate/406338886641   "Gucci YA1264153 watch"
 *   evaluate/358471670268   "Travis Scott AJ1 Mocha (sz 11)"
 *
 * Outputs:
 *   /tmp/flipagent-mocks/fixtures.json
 *   apps/docs/public/demo/<itemId>.jpg     (one per unique listing)
 *
 * Run:
 *   npm --workspace @flipagent/api exec -- tsx src/scripts/fetch-quickstart-mocks.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as _config } from "../config.js";
import { scrapeItemDetail, scrapeSearch } from "../services/ebay/scrape/client.js";

void _config;

const OUT_DIR = "/tmp/flipagent-mocks";
const PUBLIC_DEMO = "/Users/jinho/Projects/flipagent/apps/docs/public/demo";

interface DiscoverPreset {
	key: string;
	q: string;
	categoryId?: string;
	priceMin?: number;
	priceMax?: number;
	conditionIds?: string[];
}

interface EvaluatePreset {
	key: string;
	itemId: string;
	keyword: string;
}

const DISCOVER_PRESETS: DiscoverPreset[] = [
	{ key: "watches", q: "watch", categoryId: "31387", priceMax: 300, conditionIds: ["3000"] },
	{ key: "charizard", q: "charizard 1st edition", categoryId: "183454", conditionIds: ["3000"] },
];

const EVALUATE_PRESETS: EvaluatePreset[] = [
	{ key: "gucci-watch", itemId: "v1|406338886641|0", keyword: "Gucci YA1264153" },
	{ key: "aj1-mocha", itemId: "v1|358471670268|0", keyword: "Travis Scott Air Jordan 1 Mocha" },
];

const TARGET_ACTIVE_PER_PRESET = 6;
const TARGET_SOLD_PER_PRESET = 30;

async function downloadImage(itemId: string, srcUrl: string): Promise<string | null> {
	const upgraded = srcUrl.replace(/s-l\d+\.jpg/, "s-l800.jpg");
	const slug = itemId.replace(/\W+/g, "_");
	try {
		const res = await fetch(upgraded);
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		// Skip eBay's "image not found" placeholder (≈1.3KB)
		if (buf.length < 5_000) return null;
		const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
		const ext = mime.endsWith("png") ? "png" : "jpg";
		const localName = `${slug}.${ext}`;
		await writeFile(join(PUBLIC_DEMO, localName), buf);
		return `/demo/${localName}`;
	} catch {
		return null;
	}
}

async function fetchDiscoverPreset(preset: DiscoverPreset): Promise<unknown> {
	console.log(`\n[discover/${preset.key}] q=${JSON.stringify(preset.q)} cat=${preset.categoryId ?? "-"}`);

	let filter: string | undefined;
	const filterParts: string[] = [];
	if (preset.priceMin || preset.priceMax) {
		const lo = preset.priceMin ?? 0;
		const hi = preset.priceMax ?? 999999;
		filterParts.push(`price:[${lo}..${hi}],priceCurrency:USD`);
	}
	if (filterParts.length) filter = filterParts.join(",");

	const active = await scrapeSearch({
		q: preset.q,
		binOnly: true,
		conditionIds: preset.conditionIds,
		sort: "pricePlusShippingLowest",
		limit: 24,
	});
	const summaries = ("itemSummaries" in active ? active.itemSummaries : []) ?? [];

	const filtered = summaries.filter((s) => {
		if (!s.image?.imageUrl) return false;
		const cents = Math.round((Number.parseFloat(s.price?.value ?? "0") || 0) * 100);
		if (preset.priceMin && cents < preset.priceMin * 100) return false;
		if (preset.priceMax && cents > preset.priceMax * 100) return false;
		return true;
	});
	console.log(`  active: ${summaries.length} → ${filtered.length} after price/image filter`);

	const picked: Array<Record<string, unknown>> = [];
	for (const item of filtered) {
		if (picked.length >= TARGET_ACTIVE_PER_PRESET) break;
		const localUrl = await downloadImage(item.itemId, item.image!.imageUrl!);
		if (!localUrl) {
			console.log(`    - ${item.itemId} skip (image fetch failed or placeholder)`);
			continue;
		}
		picked.push({ ...item, image: { imageUrl: localUrl } });
		console.log(`    ✓ ${item.itemId} $${item.price?.value} → ${localUrl}`);
	}

	const sold = await scrapeSearch({
		q: preset.q,
		soldOnly: true,
		conditionIds: preset.conditionIds,
		limit: 200,
	});
	const allSales = ("itemSales" in sold ? sold.itemSales : []) ?? [];

	// Keep sold within the active price band (real discover clusters by
	// title similarity; this approximates by price proximity for the mock).
	const soldFiltered = allSales.filter((s) => {
		const c = Math.round((Number.parseFloat(s.lastSoldPrice?.value ?? "0") || 0) * 100);
		if (preset.priceMin && c < preset.priceMin * 100) return false;
		if (preset.priceMax && c > preset.priceMax * 100) return false;
		// If no preset bands, drop pennies + extreme luxury outliers
		if (!preset.priceMin && !preset.priceMax && (c < 500 || c > 1_000_00)) return false;
		return true;
	});
	console.log(`  sold: ${allSales.length} → ${soldFiltered.length} after price-band filter`);

	return {
		preset,
		filter,
		activeListings: picked,
		soldListings: soldFiltered.slice(0, TARGET_SOLD_PER_PRESET),
	};
}

async function fetchEvaluatePreset(preset: EvaluatePreset): Promise<unknown> {
	console.log(`\n[evaluate/${preset.key}] keyword=${JSON.stringify(preset.keyword)}`);

	// The hard-coded itemId in PlaygroundEvaluate's QUICKSTART_EXAMPLES is
	// frequently stale (eBay listings expire ~30d). Resolve by searching
	// the keyword and taking the cheapest live listing with an image — same
	// strategy a logged-in user would get on first click.
	const search = await scrapeSearch({
		q: preset.keyword,
		binOnly: true,
		conditionIds: ["3000"],
		sort: "pricePlusShippingLowest",
		limit: 12,
	});
	const candidates = (("itemSummaries" in search ? search.itemSummaries : []) ?? []).filter(
		(s) => s.image?.imageUrl && Number.parseFloat(s.price?.value ?? "0") > 0,
	);
	if (!candidates.length) {
		console.log("  ! no live listing found for keyword");
		return { preset, detail: null };
	}

	// Try up to the first 5 candidates — detail fetch is flaky for some
	// listings (privacy-mode sellers, blocked variants, etc).
	let live: (typeof candidates)[number] | null = null;
	let detail: Awaited<ReturnType<typeof scrapeItemDetail>> | null = null;
	for (const cand of candidates.slice(0, 5)) {
		console.log(`  try → ${cand.itemId} "${cand.title}" $${cand.price?.value}`);
		const got = await scrapeItemDetail(cand.itemId);
		if (got) {
			live = cand;
			detail = got;
			break;
		}
		console.log("    - detail fetch failed, trying next");
	}
	if (!live || !detail) {
		console.log("  ! all candidates failed");
		return { preset, detail: null };
	}
	console.log(`  ✓ detail "${detail.title}" $${detail.price?.value}`);

	let detailWithLocalImage: typeof detail = detail;
	const detailImage = detail.image?.imageUrl ?? live.image?.imageUrl;
	if (detailImage) {
		const localUrl = await downloadImage(live.itemId, detailImage);
		if (localUrl) {
			detailWithLocalImage = { ...detail, image: { imageUrl: localUrl } };
			console.log(`    ✓ image → ${localUrl}`);
		} else {
			console.log("    - image fetch failed");
		}
	}

	const sold = await scrapeSearch({
		q: preset.keyword,
		soldOnly: true,
		conditionIds: ["3000"],
		limit: 200,
	});
	const allSales = ("itemSales" in sold ? sold.itemSales : []) ?? [];
	// Drop only the obvious outliers (>3× resolved ask) so we keep enough
	// rows for a histogram. Real evaluate clusters by title, but these
	// are keyword sold-search dumps so size/condition variance is fine.
	const askCents = Math.round((Number.parseFloat(detail.price?.value ?? "0") || 0) * 100);
	const sales = askCents
		? allSales.filter((s) => {
				const c = Math.round((Number.parseFloat(s.lastSoldPrice?.value ?? "0") || 0) * 100);
				return c > 0 && c <= askCents * 3;
			})
		: allSales;
	console.log(`  sold: ${allSales.length} → ${sales.length} after outlier trim`);

	const active = await scrapeSearch({
		q: preset.keyword,
		binOnly: true,
		conditionIds: ["3000"],
		sort: "pricePlusShippingLowest",
		limit: 30,
	});
	const activeList = ("itemSummaries" in active ? active.itemSummaries : []) ?? [];
	console.log(`  active: ${activeList.length}`);

	return {
		preset,
		detail: detailWithLocalImage,
		soldListings: sales.slice(0, TARGET_SOLD_PER_PRESET),
		activePool: activeList.slice(0, 18),
	};
}

interface RawSummary {
	itemId: string;
	title: string;
	itemWebUrl: string;
	condition?: string;
	conditionId?: string;
	price?: { value: string; currency: string };
	lastSoldPrice?: { value: string; currency: string };
	image?: { imageUrl: string };
}

interface DiscoverFx {
	preset: DiscoverPreset;
	activeListings: RawSummary[];
	soldListings: RawSummary[];
}

interface EvaluateFx {
	preset: EvaluatePreset;
	detail: RawSummary & { brand?: string; categoryPath?: string; categoryId?: string };
	soldListings: RawSummary[];
	activePool: RawSummary[];
}

const MOCKDATA_TS_PATH = "/Users/jinho/Projects/flipagent/apps/docs/src/components/playground/mockData.ts";

function priceCents(value: string | undefined): number {
	const n = Number.parseFloat(value ?? "0");
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function computeMarket(soldCents: number[], keyword: string) {
	if (!soldCents.length) {
		return { medianCents: 0, p25Cents: 0, p75Cents: 0, meanCents: 0, stdDevCents: 0, nObservations: 0, keyword };
	}
	const sorted = [...soldCents].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)]!;
	const p25 = sorted[Math.floor(sorted.length * 0.25)]!;
	const p75 = sorted[Math.floor(sorted.length * 0.75)]!;
	const mean = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
	return {
		medianCents: median,
		p25Cents: p25,
		p75Cents: p75,
		meanCents: mean,
		stdDevCents: Math.max(1, Math.round((p75 - p25) / 1.35)),
		nObservations: sorted.length,
		keyword,
	};
}

function rateCluster(askCents: number, p25: number, median: number, p75: number) {
	if (askCents <= p25) return { rating: "buy" as const, reason: "Listed at or below the 90-day p25 floor — clearest deal in the cohort." };
	if (askCents <= median) return { rating: "buy" as const, reason: `Listed below median ($${(median / 100).toFixed(0)}). Margin after fees is thin but positive.` };
	if (askCents <= p75) return { rating: "hold" as const, reason: "Asking is between median and p75 — fees eat through the spread, no edge." };
	return { rating: "skip" as const, reason: "Asking is above p75 — losing on every list price the system would pick." };
}

function emitSummary(s: RawSummary, indent = "\t"): string {
	const out = [`${indent}{`];
	out.push(`${indent}\titemId: ${JSON.stringify(s.itemId)},`);
	out.push(`${indent}\ttitle: ${JSON.stringify(s.title)},`);
	out.push(`${indent}\titemWebUrl: ${JSON.stringify(s.itemWebUrl)},`);
	if (s.condition) out.push(`${indent}\tcondition: ${JSON.stringify(s.condition)},`);
	if (s.conditionId) out.push(`${indent}\tconditionId: ${JSON.stringify(s.conditionId)},`);
	if (s.price) out.push(`${indent}\tprice: { value: ${JSON.stringify(s.price.value)}, currency: ${JSON.stringify(s.price.currency)} },`);
	if (s.lastSoldPrice) out.push(`${indent}\tlastSoldPrice: { value: ${JSON.stringify(s.lastSoldPrice.value)}, currency: ${JSON.stringify(s.lastSoldPrice.currency)} },`);
	if (s.image?.imageUrl) out.push(`${indent}\timage: { imageUrl: ${JSON.stringify(s.image.imageUrl)} },`);
	out.push(`${indent}}`);
	return out.join("\n");
}

function emitDiscoverFixture(name: string, fx: DiscoverFx): string {
	const soldCents = fx.soldListings.map((s) => priceCents(s.lastSoldPrice?.value)).filter((c) => c > 0);
	const market = computeMarket(soldCents, fx.preset.q);
	const reps = [...fx.activeListings].sort((a, b) => priceCents(a.price?.value) - priceCents(b.price?.value)).slice(0, 4);
	const clusterBlocks = reps.map((rep) => {
		const askCents = priceCents(rep.price?.value);
		const verdict = rateCluster(askCents, market.p25Cents, market.medianCents, market.p75Cents);
		const expectedNet = market.medianCents - askCents;
		const expectedDays = 22;
		return `\tbuildCluster(
${emitSummary(rep, "\t\t")},
\t\t{
\t\t\trating: ${JSON.stringify(verdict.rating)},
\t\t\texpectedNetCents: ${expectedNet},
\t\t\tbidCeilingCents: ${Math.round(market.p25Cents * 0.92)},
\t\t\tconfidence: ${(0.7 + Math.min(0.2, market.nObservations / 200)).toFixed(2)},
\t\t\treason: ${JSON.stringify(verdict.reason)},
\t\t\trecommendedExit: { listPriceCents: ${market.p75Cents}, expectedDaysToSell: ${expectedDays}, netCents: ${expectedNet}, dollarsPerDay: ${Math.round((expectedNet / expectedDays) * 100) / 100} },
\t\t},
\t\t${name}_SOLD.slice(0, ${Math.min(soldCents.length, 6)}),
\t)`;
	}).join(",\n");

	return `const ${name}_ACTIVE: ItemSummary[] = [
${fx.activeListings.map((s) => emitSummary(s)).join(",\n")},
];

const ${name}_SOLD: ItemSummary[] = [
${fx.soldListings.map((s) => emitSummary(s)).join(",\n")},
];

const ${name}_MARKET: MarketStats = {
\tkeyword: ${JSON.stringify(market.keyword)},
\tmarketplace: "EBAY_US",
\twindowDays: 90,
\tmeanCents: ${market.meanCents},
\tstdDevCents: ${market.stdDevCents},
\tmedianCents: ${market.medianCents},
\tp25Cents: ${market.p25Cents},
\tp75Cents: ${market.p75Cents},
\tnObservations: ${market.nObservations},
\tsalesPerDay: ${(market.nObservations / 90).toFixed(2)},
\tmeanDaysToSell: 22,
};

const ${name}_CLUSTERS: DealCluster[] = [
${clusterBlocks},
];

export const ${name} = {
\tsearch: { itemSummaries: ${name}_ACTIVE, total: ${fx.activeListings.length} } satisfies BrowseSearchResponse,
\tsold: { itemSales: ${name}_SOLD, total: ${market.nObservations} } satisfies BrowseSearchResponse,
\tclusters: ${name}_CLUSTERS,
\tmarket: ${name}_MARKET,
};`;
}

function emitEvaluateFixture(name: string, fx: EvaluateFx): string {
	const soldCents = fx.soldListings.map((s) => priceCents(s.lastSoldPrice?.value)).filter((c) => c > 0);
	const market = computeMarket(soldCents, fx.preset.keyword);
	const askCents = priceCents(fx.detail.price?.value);
	const verdict = rateCluster(askCents, market.p25Cents, market.medianCents, market.p75Cents);
	const expectedNet = market.medianCents - askCents;
	return `const ${name}_DETAIL: ItemDetail = {
\titemId: ${JSON.stringify(fx.detail.itemId)},
\tlegacyItemId: ${JSON.stringify(fx.detail.itemId.replace(/^v1\|/, "").replace(/\|0$/, ""))},
\ttitle: ${JSON.stringify(fx.detail.title)},
\titemWebUrl: ${JSON.stringify(fx.detail.itemWebUrl)},
\tcondition: ${JSON.stringify(fx.detail.condition ?? "Pre-owned")},
\tconditionId: ${JSON.stringify(fx.detail.conditionId ?? "3000")},
\tprice: { value: ${JSON.stringify(fx.detail.price?.value ?? "0")}, currency: ${JSON.stringify(fx.detail.price?.currency ?? "USD")} },
\timage: { imageUrl: ${JSON.stringify(fx.detail.image?.imageUrl ?? "")} },
\tbrand: ${JSON.stringify(fx.detail.brand ?? "—")},
\tcategoryPath: ${JSON.stringify(fx.detail.categoryPath ?? "")},
\tcategoryId: ${JSON.stringify(fx.detail.categoryId ?? "")},
};

const ${name}_SOLD: ItemSummary[] = [
${fx.soldListings.map((s) => emitSummary(s)).join(",\n")},
];

const ${name}_ACTIVE: ItemSummary[] = [
${fx.activePool.slice(0, 12).map((s) => emitSummary(s)).join(",\n")},
];

export const ${name}: EvaluateFixture = {
\tdetail: ${name}_DETAIL,
\tsoldPool: ${name}_SOLD,
\tactivePool: ${name}_ACTIVE,
\tmarketSummary: {
\t\tmarket: {
\t\t\tkeyword: ${JSON.stringify(market.keyword)},
\t\t\tmarketplace: "ebay_us",
\t\t\twindowDays: 90,
\t\t\tmeanCents: ${market.meanCents},
\t\t\tstdDevCents: ${market.stdDevCents},
\t\t\tmedianCents: ${market.medianCents},
\t\t\tmedianCiLowCents: ${Math.round(market.medianCents * 0.96)},
\t\t\tmedianCiHighCents: ${Math.round(market.medianCents * 1.04)},
\t\t\tp25Cents: ${market.p25Cents},
\t\t\tp75Cents: ${market.p75Cents},
\t\t\tnObservations: ${market.nObservations},
\t\t\tsalesPerDay: ${(market.nObservations / 90).toFixed(2)},
\t\t\tmeanDaysToSell: 22,
\t\t\tdaysP50: 18,
\t\t\tdaysP70: 28,
\t\t\tdaysP90: 47,
\t\t\tnDurations: ${market.nObservations},
\t\t},
\t\tlistPriceRecommendation: {
\t\t\tlistPriceCents: ${market.p75Cents},
\t\t\texpectedDaysToSell: 22,
\t\t\tsellProb7d: 0.30,
\t\t\tsellProb14d: 0.51,
\t\t\tsellProb30d: 0.78,
\t\t\tnetCents: ${expectedNet},
\t\t\tdollarsPerDay: ${(expectedNet / 22 / 100).toFixed(2)},
\t\t\tannualizedRoi: ${((expectedNet / Math.max(1, askCents)) * (365 / 22)).toFixed(2)},
\t\t},
\t},
\tevaluation: {
\t\trating: ${JSON.stringify(verdict.rating)},
\t\texpectedNetCents: ${expectedNet},
\t\tbidCeilingCents: ${Math.round(market.p25Cents * 0.92)},
\t\tconfidence: ${(0.7 + Math.min(0.2, market.nObservations / 200)).toFixed(2)},
\t\treason: ${JSON.stringify(verdict.reason)},
\t},
\treturns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
};`;
}

function generateMockDataTs(discover: Record<string, DiscoverFx>, evaluate: Record<string, EvaluateFx>): string {
	const watches = discover.watches!;
	const charizard = discover.charizard!;
	const gucci = Object.values(evaluate).find((fx) => fx.preset.key === "gucci-watch");
	const aj1 = Object.values(evaluate).find((fx) => fx.preset.key === "aj1-mocha");
	if (!gucci || !aj1) throw new Error("missing evaluate fixtures");

	const header = `/**
 * GENERATED — do not edit by hand.
 * Source: \`packages/api/src/scripts/fetch-quickstart-mocks.ts\`
 * Fetched: ${new Date().toISOString()}
 *
 * Real listings + sold-pool data for the four QuickStart presets shown
 * to logged-out visitors in the landing-hero playground:
 *   discover/watches      "Watches under $300"
 *   discover/charizard    "Pokémon Charizard"
 *   evaluate/${gucci.detail.itemId}   "${gucci.preset.keyword}"
 *   evaluate/${aj1.detail.itemId}   "${aj1.preset.keyword}"
 *
 * Free-text input in mockMode redirects to /signup — quickstarts only.
 */

import type {
	BrowseSearchResponse,
	DealCluster,
	Evaluation,
	ItemDetail,
	ItemSummary,
	MarketSummary,
	MarketStats,
} from "./types";

interface EvaluateFixture {
	detail: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	marketSummary: MarketSummary;
	evaluation: Evaluation;
	returns?: { accepted: boolean; periodDays?: number; shippingCostPaidBy?: "BUYER" | "SELLER" } | null;
}

function buildCluster(rep: ItemSummary, evaluation: Evaluation, soldSubset: ItemSummary[]): DealCluster {
	const detail: ItemDetail = { ...rep };
	return {
		canonical: rep.title,
		source: "singleton",
		count: 1,
		item: detail,
		soldPool: soldSubset,
		activePool: [rep],
		rejectedSoldPool: [],
		rejectedActivePool: [],
		market: {
			keyword: rep.title,
			marketplace: "EBAY_US",
			windowDays: 90,
			meanCents: 0,
			stdDevCents: 0,
			medianCents: 0,
			p25Cents: 0,
			p75Cents: 0,
			nObservations: soldSubset.length,
			salesPerDay: 0,
			meanDaysToSell: 22,
		},
		evaluation,
		returns: { accepted: true, periodDays: 30 },
		meta: {
			itemSource: "scrape",
			soldCount: soldSubset.length,
			soldSource: "scrape",
			activeCount: 1,
			activeSource: "scrape",
			soldKept: soldSubset.length,
			soldRejected: 0,
			activeKept: 1,
			activeRejected: 0,
		},
	};
}

`;

	const dispatcher = `

export type DiscoverInputs = { q: string; categoryId?: string };

export function mockDiscoverFixture(inputs: DiscoverInputs): typeof MOCK_WATCHES {
	if (inputs.categoryId === ${JSON.stringify(charizard.preset.categoryId ?? "")} || /charizard/i.test(inputs.q)) {
		return MOCK_CHARIZARD;
	}
	return MOCK_WATCHES;
}

const FIXTURES_BY_ITEM_ID: Record<string, EvaluateFixture> = {
	${JSON.stringify(gucci.detail.itemId)}: MOCK_GUCCI,
	${JSON.stringify(aj1.detail.itemId)}: MOCK_AJ1,
};

export function mockEvaluateFixture(itemId: string): EvaluateFixture {
	const hit = FIXTURES_BY_ITEM_ID[itemId];
	if (hit) return hit;
	return { ...MOCK_GUCCI, detail: { ...MOCK_GUCCI.detail, itemId, legacyItemId: itemId.replace(/^v1\\|/, "").replace(/\\|0$/, "") } };
}

// Legacy export — pipelines.ts still imports MOCK_DISCOVER. Aliased to the
// watches fixture so existing callers default to it; new code should call
// mockDiscoverFixture(inputs) explicitly.
export const MOCK_DISCOVER = MOCK_WATCHES;
`;

	return [
		header,
		emitDiscoverFixture("MOCK_WATCHES", watches),
		"",
		emitDiscoverFixture("MOCK_CHARIZARD", charizard),
		"",
		emitEvaluateFixture("MOCK_GUCCI", gucci),
		"",
		emitEvaluateFixture("MOCK_AJ1", aj1),
		dispatcher,
	].join("\n");
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	await mkdir(PUBLIC_DEMO, { recursive: true });

	const discover: Record<string, DiscoverFx> = {};
	for (const preset of DISCOVER_PRESETS) {
		discover[preset.key] = (await fetchDiscoverPreset(preset)) as DiscoverFx;
	}

	const evaluate: Record<string, EvaluateFx> = {};
	for (const preset of EVALUATE_PRESETS) {
		evaluate[preset.itemId] = (await fetchEvaluatePreset(preset)) as EvaluateFx;
	}

	const out = { discover, evaluate, fetchedAt: new Date().toISOString() };
	const dest = join(OUT_DIR, "fixtures.json");
	await writeFile(dest, JSON.stringify(out, null, "\t"));
	console.log(`\n✓ wrote ${dest}`);
	console.log(`✓ images in ${PUBLIC_DEMO}/`);

	const ts = generateMockDataTs(discover, evaluate);
	await writeFile(MOCKDATA_TS_PATH, ts);
	console.log(`✓ wrote ${MOCKDATA_TS_PATH}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
