/**
 * Mock fixtures for the logged-out playground (rendered inside the
 * landing hero). Same shapes the real API returns so the existing
 * Discover/Evaluate UI can render them without a code path of its own —
 * the pipeline runner just swaps the data source.
 *
 * Two evaluate fixtures keyed by itemId match the playground's quickstart
 * examples, with a generic fallback for any other input. The discover
 * fixture ignores filters: the value is showing what the result UI looks
 * like, not faking a search engine.
 */

import type {
	BrowseSearchResponse,
	ItemDetail,
	ItemSummary,
	MatchResponse,
	RankedDeal,
	MarketSummary,
	Evaluation,
} from "./types";

/* -------------------------------- discover -------------------------------- */

const DISCOVER_ACTIVE: ItemSummary[] = [
	{
		itemId: "v1|406338886641|0",
		title: "Gucci YA1264153 Black Stainless Steel Quartz 38mm",
		itemWebUrl: "https://www.ebay.com/itm/406338886641",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "189.00", currency: "USD" },
		image: { imageUrl: "https://i.ebayimg.com/images/g/jKkAAOSwYa9mfCtY/s-l500.jpg" },
	},
	{
		itemId: "v1|406336551572|0",
		title: "Gucci YA1264155 PVD Watch 38mm Black Dial",
		itemWebUrl: "https://www.ebay.com/itm/406336551572",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "234.00", currency: "USD" },
		image: { imageUrl: "https://i.ebayimg.com/images/g/oEsAAOSwOJVmexCo/s-l500.jpg" },
	},
	{
		itemId: "v1|395721093041|0",
		title: "Gucci YA126402 G-Timeless Black Leather 38mm",
		itemWebUrl: "https://www.ebay.com/itm/395721093041",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "312.00", currency: "USD" },
		image: { imageUrl: "https://i.ebayimg.com/images/g/wSwAAOSwGE9j7qjM/s-l500.jpg" },
	},
	{
		itemId: "v1|285904712214|0",
		title: "Gucci YA1264033 Pantheon 44mm Stainless",
		itemWebUrl: "https://www.ebay.com/itm/285904712214",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "415.00", currency: "USD" },
		image: { imageUrl: "https://i.ebayimg.com/images/g/sqkAAOSwbxRjuUKr/s-l500.jpg" },
	},
];

const DISCOVER_SOLD: ItemSummary[] = [
	{
		itemId: "v1|sold-1|0",
		title: "Gucci YA1264153 38mm Black Quartz",
		itemWebUrl: "https://www.ebay.com/itm/000000001",
		condition: "Pre-owned",
		lastSoldPrice: { value: "315.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-2|0",
		title: "Gucci YA1264153 Black Steel Watch",
		itemWebUrl: "https://www.ebay.com/itm/000000002",
		condition: "Pre-owned",
		lastSoldPrice: { value: "289.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-3|0",
		title: "Gucci YA1264155 PVD 38mm",
		itemWebUrl: "https://www.ebay.com/itm/000000003",
		condition: "Pre-owned",
		lastSoldPrice: { value: "362.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-4|0",
		title: "Gucci G-Timeless YA126402",
		itemWebUrl: "https://www.ebay.com/itm/000000004",
		condition: "Pre-owned",
		lastSoldPrice: { value: "395.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-5|0",
		title: "Gucci Pantheon 44mm",
		itemWebUrl: "https://www.ebay.com/itm/000000005",
		condition: "Pre-owned",
		lastSoldPrice: { value: "478.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-6|0",
		title: "Gucci YA1264153 black quartz",
		itemWebUrl: "https://www.ebay.com/itm/000000006",
		condition: "Pre-owned",
		lastSoldPrice: { value: "302.00", currency: "USD" },
	},
];

const DISCOVER_DEALS: RankedDeal[] = [
	{
		itemId: "v1|406338886641|0",
		evaluation: {
			rating: "buy",
			expectedNetCents: 8400,
			bidCeilingCents: 22500,
			winProbability: 0.78,
			confidence: 0.86,
			reason: "Listed $113 below median; sample n=42, dispersion low.",
		},
	},
	{
		itemId: "v1|406336551572|0",
		evaluation: {
			rating: "buy",
			expectedNetCents: 6100,
			bidCeilingCents: 27800,
			winProbability: 0.71,
			confidence: 0.81,
		},
	},
	{
		itemId: "v1|395721093041|0",
		evaluation: {
			rating: "hold",
			expectedNetCents: 1900,
			bidCeilingCents: 30000,
			winProbability: 0.54,
			confidence: 0.66,
		},
	},
	{
		itemId: "v1|285904712214|0",
		evaluation: {
			rating: "skip",
			expectedNetCents: -1100,
			bidCeilingCents: 39000,
			winProbability: 0.34,
			confidence: 0.72,
		},
	},
];

export const MOCK_DISCOVER = {
	search: {
		itemSummaries: DISCOVER_ACTIVE,
		total: 247,
	} satisfies BrowseSearchResponse,
	sold: {
		itemSales: DISCOVER_SOLD,
		total: 42,
	} satisfies BrowseSearchResponse,
	ranked: { deals: DISCOVER_DEALS },
};

/* -------------------------------- evaluate -------------------------------- */

interface EvaluateFixture {
	detail: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	buckets: MatchResponse;
	marketSummary: MarketSummary;
	evaluation: Evaluation;
}

function buildSoldPool(seed: { titlePrefix: string; centerCents: number; spreadCents: number; n: number }): ItemSummary[] {
	const out: ItemSummary[] = [];
	for (let i = 0; i < seed.n; i++) {
		// Deterministic spread around the center. ~70% within ±half-spread,
		// ~30% in the wider tails so the histogram has shape.
		const offset = ((i * 9301 + 49297) % 233280) / 233280; // 0..1, deterministic
		const signed = (offset - 0.5) * 2; // -1..1
		const skew = signed * signed * signed; // ease toward center
		const cents = Math.max(500, Math.round(seed.centerCents + skew * seed.spreadCents));
		out.push({
			itemId: `v1|sold-${seed.titlePrefix.replace(/\s+/g, "-")}-${i}|0`,
			title: `${seed.titlePrefix} #${i + 1}`,
			itemWebUrl: `https://www.ebay.com/itm/sold-${i}`,
			condition: "Pre-owned",
			lastSoldPrice: { value: (cents / 100).toFixed(2), currency: "USD" },
		});
	}
	return out;
}

function buildActivePool(seed: { titlePrefix: string; centerCents: number; spreadCents: number; n: number }): ItemSummary[] {
	const out: ItemSummary[] = [];
	for (let i = 0; i < seed.n; i++) {
		const offset = ((i * 7919 + 12347) % 100000) / 100000;
		const cents = Math.max(500, Math.round(seed.centerCents - 800 + (offset - 0.5) * seed.spreadCents));
		out.push({
			itemId: `v1|active-${seed.titlePrefix.replace(/\s+/g, "-")}-${i}|0`,
			title: `${seed.titlePrefix} listing ${i + 1}`,
			itemWebUrl: `https://www.ebay.com/itm/active-${i}`,
			condition: "Pre-owned",
			price: { value: (cents / 100).toFixed(2), currency: "USD" },
		});
	}
	return out;
}

const GUCCI_BLACK: EvaluateFixture = (() => {
	const detail: ItemDetail = {
		itemId: "v1|406338886641|0",
		legacyItemId: "406338886641",
		title: "Gucci YA1264153 Black Stainless Steel Quartz 38mm Men's Watch",
		itemWebUrl: "https://www.ebay.com/itm/406338886641",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "189.00", currency: "USD" },
		image: { imageUrl: "https://i.ebayimg.com/images/g/jKkAAOSwYa9mfCtY/s-l500.jpg" },
		brand: "Gucci",
		categoryPath: "Jewelry & Watches/Watches, Parts & Accessories/Watches/Wristwatches",
		categoryId: "31387",
		localizedAspects: [
			{ name: "Brand", value: "Gucci" },
			{ name: "Model", value: "YA1264153" },
			{ name: "Case Size", value: "38 mm" },
			{ name: "Movement", value: "Quartz" },
		],
	};
	const sold = buildSoldPool({ titlePrefix: "Gucci YA1264153", centerCents: 30200, spreadCents: 9000, n: 42 });
	const active = buildActivePool({ titlePrefix: "Gucci YA1264153", centerCents: 28200, spreadCents: 8000, n: 18 });
	const matched = sold.slice(0, 31);
	const reject = sold.slice(31);
	return {
		detail,
		soldPool: sold,
		activePool: active,
		buckets: {
			match: matched.map((m) => ({ item: m, bucket: "match" as const, reason: "Same model + size" })),
			reject: reject.map((m) => ({ item: m, bucket: "reject" as const, reason: "Different reference" })),
			totals: { match: matched.length, reject: reject.length },
		},
		marketSummary: {
			market: {
				keyword: "Gucci YA1264153",
				marketplace: "ebay_us",
				windowDays: 90,
				meanCents: 30200,
				stdDevCents: 4100,
				medianCents: 30200,
				medianCiLowCents: 29200,
				medianCiHighCents: 31200,
				p25Cents: 27800,
				p75Cents: 32400,
				nObservations: 42,
				salesPerDay: 0.47,
				meanDaysToSell: 18,
				daysP50: 16,
				daysP70: 24,
				daysP90: 41,
				nDurations: 42,
			},
			listPriceRecommendation: {
				listPriceCents: 30200,
				expectedDaysToSell: 18,
				sellProb7d: 0.31,
				sellProb14d: 0.52,
				sellProb30d: 0.78,
				netCents: 8400,
				dollarsPerDay: 4.7,
				annualizedRoi: 0.91,
			},
		},
		evaluation: {
			rating: "buy",
			expectedNetCents: 8400,
			bidCeilingCents: 22500,
			winProbability: 0.78,
			confidence: 0.86,
			reason: "Listed $113 below median with 42 dense comparables and steady selling pace.",
			signals: [
				{ name: "under_median", reason: "Asking is 38% below the 90-day median." },
				{ name: "tight_spread", reason: "p25–p75 only $46 wide — confident pricing." },
				{ name: "good_pace", reason: "0.47 sales/day clears in ~18 days." },
			],
		},
	};
})();

const GUCCI_PVD: EvaluateFixture = (() => {
	const detail: ItemDetail = {
		itemId: "v1|406336551572|0",
		legacyItemId: "406336551572",
		title: "Gucci YA1264155 PVD 38mm Black Dial Men's Watch",
		itemWebUrl: "https://www.ebay.com/itm/406336551572",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "234.00", currency: "USD" },
		image: { imageUrl: "https://i.ebayimg.com/images/g/oEsAAOSwOJVmexCo/s-l500.jpg" },
		brand: "Gucci",
		categoryPath: "Jewelry & Watches/Watches/Wristwatches",
		categoryId: "31387",
		localizedAspects: [
			{ name: "Brand", value: "Gucci" },
			{ name: "Model", value: "YA1264155" },
			{ name: "Case Material", value: "PVD" },
		],
	};
	const sold = buildSoldPool({ titlePrefix: "Gucci YA1264155 PVD", centerCents: 35200, spreadCents: 8500, n: 28 });
	const active = buildActivePool({ titlePrefix: "Gucci YA1264155 PVD", centerCents: 33500, spreadCents: 7600, n: 11 });
	const matched = sold.slice(0, 19);
	const reject = sold.slice(19);
	return {
		detail,
		soldPool: sold,
		activePool: active,
		buckets: {
			match: matched.map((m) => ({ item: m, bucket: "match" as const, reason: "Same PVD reference" })),
			reject: reject.map((m) => ({ item: m, bucket: "reject" as const, reason: "Different model" })),
			totals: { match: matched.length, reject: reject.length },
		},
		marketSummary: {
			market: {
				keyword: "Gucci YA1264155 PVD",
				marketplace: "ebay_us",
				windowDays: 90,
				meanCents: 35200,
				stdDevCents: 3700,
				medianCents: 35200,
				medianCiLowCents: 34000,
				medianCiHighCents: 36400,
				p25Cents: 32800,
				p75Cents: 37700,
				nObservations: 28,
				salesPerDay: 0.31,
				meanDaysToSell: 26,
				daysP50: 24,
				daysP70: 35,
				daysP90: 58,
				nDurations: 28,
			},
			listPriceRecommendation: {
				listPriceCents: 35200,
				expectedDaysToSell: 26,
				sellProb7d: 0.21,
				sellProb14d: 0.41,
				sellProb30d: 0.64,
				netCents: 6100,
				dollarsPerDay: 2.3,
				annualizedRoi: 0.55,
			},
		},
		evaluation: {
			rating: "buy",
			expectedNetCents: 6100,
			bidCeilingCents: 27800,
			winProbability: 0.71,
			confidence: 0.81,
			reason: "Listed $118 below median; PVD variant sells slower but still within 30-day window.",
			signals: [
				{ name: "under_median", reason: "Asking is 33% below the 90-day median." },
				{ name: "moderate_pace", reason: "0.31 sales/day — typical for PVD finish." },
			],
		},
	};
})();

const GENERIC_FALLBACK: EvaluateFixture = (() => {
	const detail: ItemDetail = {
		itemId: "v1|000000000000|0",
		legacyItemId: "000000000000",
		title: "Sample listing — sign in to evaluate any real eBay item",
		itemWebUrl: "https://www.ebay.com/itm/000000000000",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "120.00", currency: "USD" },
		image: { imageUrl: "" },
		brand: "—",
	};
	const sold = buildSoldPool({ titlePrefix: "Sample comparable", centerCents: 16800, spreadCents: 5200, n: 24 });
	const active = buildActivePool({ titlePrefix: "Sample comparable", centerCents: 15500, spreadCents: 4800, n: 9 });
	const matched = sold.slice(0, 16);
	const reject = sold.slice(16);
	return {
		detail,
		soldPool: sold,
		activePool: active,
		buckets: {
			match: matched.map((m) => ({ item: m, bucket: "match" as const, reason: "Matched on title" })),
			reject: reject.map((m) => ({ item: m, bucket: "reject" as const, reason: "Different product" })),
			totals: { match: matched.length, reject: reject.length },
		},
		marketSummary: {
			market: {
				keyword: "Sample comparable",
				marketplace: "ebay_us",
				windowDays: 90,
				meanCents: 16800,
				stdDevCents: 2100,
				medianCents: 16800,
				medianCiLowCents: 16100,
				medianCiHighCents: 17500,
				p25Cents: 15200,
				p75Cents: 18400,
				nObservations: 24,
				salesPerDay: 0.27,
				meanDaysToSell: 22,
				daysP50: 20,
				daysP70: 30,
				daysP90: 50,
				nDurations: 24,
			},
			listPriceRecommendation: {
				listPriceCents: 16800,
				expectedDaysToSell: 22,
				sellProb7d: 0.24,
				sellProb14d: 0.46,
				sellProb30d: 0.71,
				netCents: 3600,
				dollarsPerDay: 1.6,
				annualizedRoi: 0.47,
			},
		},
		evaluation: {
			rating: "buy",
			expectedNetCents: 3600,
			bidCeilingCents: 13800,
			winProbability: 0.66,
			confidence: 0.74,
			reason: "Demo result — sign in to evaluate any real eBay item.",
			signals: [
				{ name: "under_median", reason: "Asking is 29% below the typical price." },
			],
		},
	};
})();

const FIXTURES_BY_ITEM_ID: Record<string, EvaluateFixture> = {
	"v1|406338886641|0": GUCCI_BLACK,
	"v1|406336551572|0": GUCCI_PVD,
};

export function mockEvaluateFixture(itemId: string): EvaluateFixture {
	return FIXTURES_BY_ITEM_ID[itemId] ?? {
		...GENERIC_FALLBACK,
		detail: { ...GENERIC_FALLBACK.detail, itemId, legacyItemId: itemId.replace(/^v1\|/, "").replace(/\|0$/, "") },
	};
}
