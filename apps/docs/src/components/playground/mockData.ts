/**
 * Mock fixtures for the logged-out playground (rendered inside the
 * landing hero). Same shapes the real API returns so the existing
 * Discover/Evaluate UI can render them without a code path of its own —
 * the pipeline runner just swaps the data source.
 *
 * All listings, sold prices, item ids, and titles below were pulled
 * from a real eBay query for "Canon EF 50mm f/1.8 STM" via the in-tree
 * scraper. The thumbnail PNGs in /public/demo/ are catalog re-renders
 * of those original listing photos (white background) verified to show
 * the same physical lens. Source pull lives in
 * `packages/api/src/scripts/fetch-canon-mocks.ts`.
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

/* -------------------------------- discover -------------------------------- */

const DISCOVER_ACTIVE: ItemSummary[] = [
	{
		itemId: "v1|327130642322|0",
		title: "Canon EF 50mm F/1.8 STM Prime Lens - Black",
		itemWebUrl: "https://www.ebay.com/itm/327130642322",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "80.00", currency: "USD" },
		image: { imageUrl: "/demo/canon-50-4.png" },
	},
	{
		itemId: "v1|316704740560|0",
		title: "Canon EF50mm F1.8 STM Standard Prime Lens for EOS DSLR — Black",
		itemWebUrl: "https://www.ebay.com/itm/316704740560",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "90.00", currency: "USD" },
		image: { imageUrl: "/demo/canon-50-3.png" },
	},
	{
		itemId: "v1|377151909505|0",
		title: "Canon EF 50mm f/1.8 STM Lens with Front and Rear Caps",
		itemWebUrl: "https://www.ebay.com/itm/377151909505",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "89.95", currency: "USD" },
		image: { imageUrl: "/demo/canon-50-1.png" },
	},
	{
		itemId: "v1|397477381402|0",
		title: "Canon EF 50mm f/1.8 STM Camera Lens — without front lens cap",
		itemWebUrl: "https://www.ebay.com/itm/397477381402",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "95.00", currency: "USD" },
		image: { imageUrl: "/demo/canon-50-2.png" },
	},
];

const DISCOVER_SOLD: ItemSummary[] = [
	{
		itemId: "v1|sold-1|0",
		title: "Canon EF 50mm f/1.8 STM Lens",
		itemWebUrl: "https://www.ebay.com/itm/298276897141",
		condition: "Pre-owned",
		lastSoldPrice: { value: "79.99", currency: "USD" },
	},
	{
		itemId: "v1|sold-2|0",
		title: "Canon EF 50mm F/1.8 STM",
		itemWebUrl: "https://www.ebay.com/itm/127838559356",
		condition: "Pre-owned",
		lastSoldPrice: { value: "89.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-3|0",
		title: "Canon EF 50mm f/1.8 STM Lens (U40291)",
		itemWebUrl: "https://www.ebay.com/itm/277922491009",
		condition: "Pre-owned",
		lastSoldPrice: { value: "91.00", currency: "USD" },
	},
	{
		itemId: "v1|sold-4|0",
		title: "Canon EF 50mm f/1.8 STM Standard Lens for Canon EF Mount",
		itemWebUrl: "https://www.ebay.com/itm/298265494142",
		condition: "Pre-owned",
		lastSoldPrice: { value: "67.67", currency: "USD" },
	},
	{
		itemId: "v1|sold-5|0",
		title: "Canon EF 50mm f/1.8 STM Lens Prime Portrait Fast AF",
		itemWebUrl: "https://www.ebay.com/itm/168296931239",
		condition: "Pre-owned",
		lastSoldPrice: { value: "96.95", currency: "USD" },
	},
	{
		itemId: "v1|sold-6|0",
		title: "Canon 50mm f/1.8 STM",
		itemWebUrl: "https://www.ebay.com/itm/227320834548",
		condition: "Pre-owned",
		lastSoldPrice: { value: "85.00", currency: "USD" },
	},
];

// Real Canon EF 50mm f/1.8 STM sold-pool stats (n=60, last 90 days,
// pulled live via Marketplace Insights):
//   min 4919 / p25 7999 / median 8885 / p75 9695 / max 13000
//   mean 8663 / 0.67 sales/day. Shared across every cluster — varying
//   only the active listing the cluster wraps.
const REAL_MARKET: MarketStats = {
	keyword: "Canon EF 50mm f/1.8 STM",
	marketplace: "EBAY_US",
	windowDays: 90,
	meanCents: 8663,
	stdDevCents: Math.round((9695 - 7999) / 1.35),
	medianCents: 8885,
	p25Cents: 7999,
	p75Cents: 9695,
	nObservations: 60,
	salesPerDay: 0.67,
	meanDaysToSell: 22,
};

function buildCluster(rep: ItemSummary, evaluation: Evaluation, soldSubset: ItemSummary[]): DealCluster {
	const detail: ItemDetail = {
		...rep,
		brand: "Canon",
		categoryId: "3323",
		categoryPath: "Cameras & Photo/Lenses & Filters/Lenses",
	};
	return {
		canonical: rep.title,
		source: "singleton",
		count: 1,
		item: detail,
		soldPool: soldSubset,
		activePool: [rep],
		rejectedSoldPool: [],
		rejectedActivePool: [],
		market: { ...REAL_MARKET, keyword: rep.title },
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

// Margins on Canon EF 50mm STM are thin — typical buy 80, sell ~89,
// minus 13% eBay fee + 8 in shipping = barely above breakeven. The
// mix below is buy / buy / hold / skip so the demo shows all rating
// classes the system actually emits.
const DISCOVER_CLUSTERS: DealCluster[] = [
	buildCluster(
		DISCOVER_ACTIVE[0]!,
		{
			rating: "buy",
			expectedNetCents: 480,
			bidCeilingCents: 8200,
			confidence: 0.78,
			reason: "Listed at the p25 floor with 60 sold @ $88.85 median. Tight spread, 0.67 sales/day.",
			recommendedExit: { listPriceCents: 9495, expectedDaysToSell: 18, netCents: 480, dollarsPerDay: 27 },
		},
		DISCOVER_SOLD.slice(0, 4),
	),
	buildCluster(
		DISCOVER_ACTIVE[1]!,
		{
			rating: "buy",
			expectedNetCents: 220,
			bidCeilingCents: 8800,
			confidence: 0.71,
			reason: "List at p75 to capture the $9 spread. Slim margin but consistent demand.",
			recommendedExit: { listPriceCents: 9695, expectedDaysToSell: 24, netCents: 220, dollarsPerDay: 9 },
		},
		[DISCOVER_SOLD[1]!, DISCOVER_SOLD[2]!],
	),
	buildCluster(
		DISCOVER_ACTIVE[2]!,
		{
			rating: "hold",
			expectedNetCents: -110,
			bidCeilingCents: 8200,
			confidence: 0.66,
			reason: "Asking is ~$1 above the 90-day median. After fees + ship-out, net is roughly zero.",
			recommendedExit: { listPriceCents: 9695, expectedDaysToSell: 28, netCents: -110, dollarsPerDay: -4 },
		},
		[DISCOVER_SOLD[3]!, DISCOVER_SOLD[5]!],
	),
	buildCluster(
		DISCOVER_ACTIVE[3]!,
		{
			rating: "skip",
			expectedNetCents: -640,
			bidCeilingCents: 8500,
			confidence: 0.74,
			reason: "Asking is above p75 — fees and shipping eat through the spread before listing.",
			recommendedExit: { listPriceCents: 10500, expectedDaysToSell: 41, netCents: -640, dollarsPerDay: -16 },
		},
		[DISCOVER_SOLD[4]!],
	),
];

export const MOCK_DISCOVER = {
	search: {
		itemSummaries: DISCOVER_ACTIVE,
		total: 247,
	} satisfies BrowseSearchResponse,
	sold: {
		itemSales: DISCOVER_SOLD,
		total: 60,
	} satisfies BrowseSearchResponse,
	clusters: DISCOVER_CLUSTERS,
};

/* -------------------------------- evaluate -------------------------------- */

interface EvaluateFixture {
	detail: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	marketSummary: MarketSummary;
	evaluation: Evaluation;
	returns?: { accepted: boolean; periodDays?: number; shippingCostPaidBy?: "BUYER" | "SELLER" } | null;
}

// Real sold prices from the Marketplace Insights pull, sorted asc.
const REAL_SOLD_PRICES_CENTS = [
	4919, 4999, 6000, 6000, 6211, 6499, 6767, 6999, 7299, 7495, 7500, 7900, 7948, 7995, 7999, 7999, 7999, 7999, 7999,
	8000, 8000, 8000, 8000, 8000, 8287, 8375, 8499, 8499, 8500, 8500, 8885, 8900, 8900, 8999, 8999, 8999, 8999, 9000,
	9000, 9100, 9100, 9200, 9300, 9400, 9500, 9695, 9699, 9799, 9900, 9900, 9999, 9999, 9999, 10000, 10500, 10885, 11000,
	11900, 12050, 13000,
];

function realSoldPool(prefix: string, count: number): ItemSummary[] {
	const stride = REAL_SOLD_PRICES_CENTS.length / count;
	const out: ItemSummary[] = [];
	for (let i = 0; i < count; i++) {
		const cents = REAL_SOLD_PRICES_CENTS[Math.min(REAL_SOLD_PRICES_CENTS.length - 1, Math.floor(i * stride))]!;
		out.push({
			itemId: `v1|sold-${prefix}-${i}|0`,
			title: `Canon EF 50mm f/1.8 STM Lens — sold ${i + 1}`,
			itemWebUrl: `https://www.ebay.com/itm/sold-${prefix}-${i}`,
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

const CANON_FLOOR: EvaluateFixture = (() => {
	const detail: ItemDetail = {
		itemId: "v1|327130642322|0",
		legacyItemId: "327130642322",
		title: "Canon EF 50mm F/1.8 STM Prime Lens - Black",
		itemWebUrl: "https://www.ebay.com/itm/327130642322",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "80.00", currency: "USD" },
		image: { imageUrl: "/demo/canon-50-4.png" },
		brand: "Canon",
		categoryPath: "Cameras & Photo/Lenses & Filters/Lenses",
		categoryId: "3323",
		localizedAspects: [
			{ name: "Brand", value: "Canon" },
			{ name: "Focal Length", value: "50mm" },
			{ name: "Maximum Aperture", value: "f/1.8" },
			{ name: "Mount", value: "Canon EF" },
			{ name: "Type", value: "Prime / Standard" },
		],
		seller: { username: "lens_emporium", feedbackScore: 18420, feedbackPercentage: "99.6" },
		shippingOptions: [{ shippingCost: { value: "8.45", currency: "USD" } }],
		buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
	};
	return {
		detail,
		soldPool: realSoldPool("327130642322", 42),
		activePool: buildActivePool({ titlePrefix: "Canon EF 50mm STM", centerCents: 8800, spreadCents: 1900, n: 18 }),
		marketSummary: {
			market: {
				keyword: "Canon EF 50mm f/1.8 STM",
				marketplace: "ebay_us",
				windowDays: 90,
				meanCents: 8663,
				stdDevCents: 1256,
				medianCents: 8885,
				medianCiLowCents: 8499,
				medianCiHighCents: 9100,
				p25Cents: 7999,
				p75Cents: 9695,
				nObservations: 60,
				salesPerDay: 0.67,
				meanDaysToSell: 22,
				daysP50: 18,
				daysP70: 28,
				daysP90: 47,
				nDurations: 60,
			},
			listPriceRecommendation: {
				listPriceCents: 9495,
				expectedDaysToSell: 18,
				sellProb7d: 0.34,
				sellProb14d: 0.55,
				sellProb30d: 0.81,
				netCents: 480,
				dollarsPerDay: 0.27,
				annualizedRoi: 0.18,
			},
		},
		evaluation: {
			rating: "buy",
			expectedNetCents: 480,
			bidCeilingCents: 8200,
			confidence: 0.78,
			reason: "Listed at the p25 floor — $80 vs $88.85 median across 60 sold in 90 days. Margin is thin after 13% fees + ship-out, but consistent.",
			signals: [
				{ name: "at_floor", reason: "Asking matches the 90-day p25 floor." },
				{ name: "tight_spread", reason: "p25–p75 only $17 wide — pricing confidence is high." },
				{ name: "steady_pace", reason: "0.67 sales/day clears in ~18 days at the median list." },
			],
		},
		returns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
	};
})();

const CANON_PREMIUM: EvaluateFixture = (() => {
	const detail: ItemDetail = {
		itemId: "v1|377151909505|0",
		legacyItemId: "377151909505",
		title: "Canon EF 50mm f/1.8 STM Lens with Front and Rear Caps",
		itemWebUrl: "https://www.ebay.com/itm/377151909505",
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: "89.95", currency: "USD" },
		image: { imageUrl: "/demo/canon-50-1.png" },
		brand: "Canon",
		categoryPath: "Cameras & Photo/Lenses & Filters/Lenses",
		categoryId: "3323",
		localizedAspects: [
			{ name: "Brand", value: "Canon" },
			{ name: "Focal Length", value: "50mm" },
			{ name: "Maximum Aperture", value: "f/1.8" },
			{ name: "Mount", value: "Canon EF" },
			{ name: "Includes", value: "Front + rear caps" },
		],
		seller: { username: "shutter_supply", feedbackScore: 7842, feedbackPercentage: "98.9" },
		shippingOptions: [{ shippingCost: { value: "9.95", currency: "USD" } }],
		buyingOptions: ["FIXED_PRICE"],
	};
	return {
		detail,
		soldPool: realSoldPool("377151909505", 42),
		activePool: buildActivePool({ titlePrefix: "Canon EF 50mm STM caps", centerCents: 9100, spreadCents: 1700, n: 14 }),
		marketSummary: {
			market: {
				keyword: "Canon EF 50mm f/1.8 STM",
				marketplace: "ebay_us",
				windowDays: 90,
				meanCents: 8663,
				stdDevCents: 1256,
				medianCents: 8885,
				medianCiLowCents: 8499,
				medianCiHighCents: 9100,
				p25Cents: 7999,
				p75Cents: 9695,
				nObservations: 60,
				salesPerDay: 0.67,
				meanDaysToSell: 22,
				daysP50: 18,
				daysP70: 28,
				daysP90: 47,
				nDurations: 60,
			},
			listPriceRecommendation: {
				listPriceCents: 9695,
				expectedDaysToSell: 24,
				sellProb7d: 0.27,
				sellProb14d: 0.46,
				sellProb30d: 0.72,
				netCents: -110,
				dollarsPerDay: -0.05,
				annualizedRoi: -0.04,
			},
		},
		evaluation: {
			rating: "hold",
			expectedNetCents: -110,
			bidCeilingCents: 8200,
			confidence: 0.66,
			reason: "Asking is $1 above median. With both caps included it's defensible, but post-fee net is roughly zero.",
			signals: [
				{ name: "at_median", reason: "Asking matches the 90-day median price." },
				{ name: "complete_kit", reason: "Front + rear caps justify a small premium." },
			],
		},
		returns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
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
		price: { value: "85.00", currency: "USD" },
		image: { imageUrl: "" },
		brand: "—",
	};
	return {
		detail,
		soldPool: realSoldPool("generic", 24),
		activePool: buildActivePool({ titlePrefix: "Sample listing", centerCents: 8800, spreadCents: 1700, n: 9 }),
		marketSummary: {
			market: {
				keyword: "Sample listing",
				marketplace: "ebay_us",
				windowDays: 90,
				meanCents: 8663,
				stdDevCents: 1256,
				medianCents: 8885,
				medianCiLowCents: 8499,
				medianCiHighCents: 9100,
				p25Cents: 7999,
				p75Cents: 9695,
				nObservations: 60,
				salesPerDay: 0.67,
				meanDaysToSell: 22,
				daysP50: 18,
				daysP70: 28,
				daysP90: 47,
				nDurations: 60,
			},
			listPriceRecommendation: {
				listPriceCents: 9495,
				expectedDaysToSell: 22,
				sellProb7d: 0.30,
				sellProb14d: 0.51,
				sellProb30d: 0.78,
				netCents: 280,
				dollarsPerDay: 0.13,
				annualizedRoi: 0.10,
			},
		},
		evaluation: {
			rating: "buy",
			expectedNetCents: 280,
			bidCeilingCents: 8200,
			confidence: 0.74,
			reason: "Demo result — sign in to evaluate any real eBay item.",
			signals: [{ name: "under_median", reason: "Asking is below the typical price." }],
		},
	};
})();

const FIXTURES_BY_ITEM_ID: Record<string, EvaluateFixture> = {
	"v1|327130642322|0": CANON_FLOOR,
	"v1|377151909505|0": CANON_PREMIUM,
};

export function mockEvaluateFixture(itemId: string): EvaluateFixture {
	return FIXTURES_BY_ITEM_ID[itemId] ?? {
		...GENERIC_FALLBACK,
		detail: { ...GENERIC_FALLBACK.detail, itemId, legacyItemId: itemId.replace(/^v1\|/, "").replace(/\|0$/, "") },
	};
}
