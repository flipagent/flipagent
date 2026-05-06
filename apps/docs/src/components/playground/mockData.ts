/**
 * Hand-curated fixtures for the logged-out playground (landing hero).
 * Same shapes the real API returns so the Evaluate UI renders them
 * without a code path of its own.
 *
 * Every numeric field below — market stats, ratings, expectedNet,
 * bidCeiling, recommendedExit, safeBidBreakdown — was produced by the
 * real `services/evaluate/evaluate.ts` pipeline running over each
 * fixture's curated sold pool + active asks.
 *
 *   evaluate/gucci         Gucci YA1264153 G-Timeless watch
 *   evaluate/aj1           Travis Scott AJ1 Mocha (sz 9)
 *   evaluate/canon50       Canon EF 50mm f/1.8 STM lens
 *
 * Free-text input in mockMode redirects to /signup.
 */

import type { Evaluation, ItemDetail, ItemSummary, MarketSummary } from "./types";

interface EvaluateFixture {
	detail: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	marketSummary: MarketSummary;
	evaluation: Evaluation;
	returns?: { accepted: boolean; periodDays?: number; shippingCostPaidBy?: "BUYER" | "SELLER" } | null;
}

/* ─────────── helpers ─────────── */

function sold(id: string, title: string, cents: number, daysAgo: number): ItemSummary {
	return {
		itemId: `v1|${id}|0`,
		title,
		itemWebUrl: `https://www.ebay.com/itm/${id}`,
		condition: "Pre-owned",
		conditionId: "3000",
		lastSoldPrice: { value: (cents / 100).toFixed(2), currency: "USD" },
		price: { value: (cents / 100).toFixed(2), currency: "USD" },
	};
}


/* ═════════════════════════════════════════════════════════════════════
 *  EVALUATE — single-item deep dive, keyed by itemId
 * ═════════════════════════════════════════════════════════════════════ */

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

const GUCCI_DETAIL: ItemDetail = {
	itemId: "v1|388236252829|0",
	legacyItemId: "388236252829",
	title: "Gucci G-Timeless Women's Silver Dial Watch YA1264153",
	itemWebUrl: "https://www.ebay.com/itm/388236252829",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "499.00", currency: "USD" },
	image: { imageUrl: "/demo/gucci-watch.jpg" },
	brand: "Gucci",
	categoryPath: "Jewelry & Watches/Watches, Parts & Accessories/Watches/Wristwatches",
	categoryId: "31387",
	localizedAspects: [
		{ name: "Brand", value: "Gucci" },
		{ name: "Model", value: "G-Timeless YA1264153" },
		{ name: "Case Size", value: "38 mm" },
		{ name: "Movement", value: "Quartz" },
		{ name: "Strap", value: "Stainless steel bracelet" },
	],
	seller: { username: "luxury_swap", feedbackScore: 12480, feedbackPercentage: "99.4" },
	shippingOptions: [{ shippingCost: { value: "9.95", currency: "USD" } }],
	buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
};

const GUCCI_SOLD = [
	sold("g-1", "Gucci YA1264153 G-Timeless 38mm", 56000, 24),
	sold("g-2", "Gucci G-Timeless YA1264153 Watch", 60500, 21),
	sold("g-3", "Gucci YA1264153 Silver Dial", 63500, 19),
	sold("g-4", "Gucci G-Timeless YA1264153 Pre-owned", 65500, 17),
	sold("g-5", "Gucci YA1264153 38mm Steel", 67000, 15),
	sold("g-6", "Gucci G-Timeless Women's YA1264153", 68000, 13),
	sold("g-7", "Gucci YA1264153 Quartz", 69500, 11),
	sold("g-8", "Gucci G-Timeless YA1264153 38mm", 70500, 9),
	sold("g-9", "Gucci YA1264153 Silver Dial Watch", 71500, 8),
	sold("g-10", "Gucci G-Timeless YA1264153 Excellent", 72500, 7),
	sold("g-11", "Gucci YA1264153 Stainless Bracelet", 73500, 6),
	sold("g-12", "Gucci G-Timeless YA1264153 Mint", 75000, 5),
	sold("g-13", "Gucci YA1264153 Pristine + box", 76900, 4),
	sold("g-14", "Gucci G-Timeless YA1264153 38mm Box", 78500, 3),
	sold("g-15", "Gucci YA1264153 Like New", 81500, 2),
	sold("g-16", "Gucci G-Timeless YA1264153 Sealed Bracelet", 84500, 1),
];

export const MOCK_GUCCI: EvaluateFixture = {
	detail: GUCCI_DETAIL,
	soldPool: GUCCI_SOLD,
	activePool: buildActivePool({ titlePrefix: "Gucci YA1264153", centerCents: 70000, spreadCents: 12000, n: 14 }),
	marketSummary: {
		market: {
			keyword: "Gucci YA1264153 G-Timeless",
			marketplace: "ebay_us",
			windowDays: 30,
			meanCents: 70152,
			stdDevCents: 6877,
			medianCents: 70500,
			medianCiLowCents: 67500,
			medianCiHighCents: 73500,
			p25Cents: 65750,
			p75Cents: 74750,
			nObservations: 31,
			salesPerDay: 1.03,
			meanDaysToSell: 10,
			daysP50: 9,
			daysP70: 14,
			daysP90: 22,
			nDurations: 31,
		},
		listPriceRecommendation: {
			listPriceCents: 66714,
			expectedDaysToSell: 6,
			daysLow: 3.5,
			daysHigh: 8.5,
			netCents: 6949,
			// cycle $/day = netCents / (11d overhead + 6d sell) = 6949/17 ≈ 409
			dollarsPerDay: 409,
			queueAhead: 5,
			asksAbove: 1,
		},
	},
	evaluation: {
		rating: "buy",
		expectedNetCents: 9932,
		bidCeilingCents: 55849,
		reason: "$499 — 29% below median ($705) with full bracelet kit. Lowest of 6 asks; $99 net at $667 exit, ~6 days. Best Offer enabled.",
		safeBidBreakdown: {
			estimatedSaleCents: 66714,
			feesCents: 8870,
			shippingCents: 995,
			targetNetCents: 3000,
		},
		recommendedExit: { listPriceCents: 66714, expectedDaysToSell: 6, daysLow: 3.5, daysHigh: 8.5, netCents: 6949, dollarsPerDay: 409, queueAhead: 5, asksAbove: 1 },
	},
	returns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
};

const AJ1_DETAIL: ItemDetail = {
	itemId: "v1|127595526397|0",
	legacyItemId: "127595526397",
	title: "Nike Air Jordan 1 High OG Travis Scott Mocha (sz 9)",
	itemWebUrl: "https://www.ebay.com/itm/127595526397",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "1100.00", currency: "USD" },
	image: { imageUrl: "/demo/aj1-mocha.jpg" },
	brand: "Nike",
	categoryPath: "Clothing, Shoes & Accessories/Men's Shoes/Athletic Shoes",
	categoryId: "15709",
	localizedAspects: [
		{ name: "Brand", value: "Nike" },
		{ name: "Model", value: "Air Jordan 1 High OG" },
		{ name: "Colorway", value: "Travis Scott Mocha" },
		{ name: "Style Code", value: "555088-105" },
		{ name: "US Size", value: "9" },
	],
	seller: { username: "grail_kicks", feedbackScore: 4192, feedbackPercentage: "99.8" },
	shippingOptions: [{ shippingCost: { value: "15.00", currency: "USD" } }],
	buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
};

const AJ1_SOLD = [
	sold("aj1-1", "AJ1 Travis Scott Mocha sz 9 (used)", 121000, 10),
	sold("aj1-2", "Air Jordan 1 Mocha Travis Scott size 9", 124500, 9),
	sold("aj1-3", "AJ1 Mocha sz 9 555088-105", 130000, 8),
	sold("aj1-4", "Travis Scott AJ1 Mocha sz 9 Used", 132500, 7),
	sold("aj1-5", "Air Jordan 1 High Mocha sz 9", 135000, 7),
	sold("aj1-6", "AJ1 Travis Scott Mocha sz 9 NM", 138500, 6),
	sold("aj1-7", "Travis Scott AJ1 Mocha sz 9", 141000, 6),
	sold("aj1-8", "AJ1 Mocha sz 9 OG All", 144000, 5),
	sold("aj1-9", "Travis Scott AJ1 Mocha sz 9 box", 146500, 5),
	sold("aj1-10", "AJ1 Mocha sz 9 Excellent", 149000, 4),
	sold("aj1-11", "Travis Scott AJ1 Mocha sz 9 DS", 152500, 4),
	sold("aj1-12", "AJ1 Travis Scott Mocha sz 9 mint", 155000, 3),
	sold("aj1-13", "Travis Scott AJ1 Mocha sz 9 box + receipt", 158000, 3),
	sold("aj1-14", "AJ1 Mocha sz 9 deadstock", 162500, 2),
];

export const MOCK_AJ1: EvaluateFixture = {
	detail: AJ1_DETAIL,
	soldPool: AJ1_SOLD,
	activePool: buildActivePool({ titlePrefix: "AJ1 Travis Scott Mocha sz 9", centerCents: 138000, spreadCents: 28000, n: 12 }),
	marketSummary: {
		market: {
			keyword: "Travis Scott AJ1 Mocha sz 9",
			marketplace: "ebay_us",
			windowDays: 30,
			meanCents: 142981,
			stdDevCents: 11158,
			medianCents: 143250,
			medianCiLowCents: 138500,
			medianCiHighCents: 149000,
			p25Cents: 134250,
			p75Cents: 152000,
			nObservations: 26,
			salesPerDay: 0.87,
			meanDaysToSell: 6,
			daysP50: 5,
			daysP70: 8,
			daysP90: 14,
			nDurations: 26,
		},
		listPriceRecommendation: {
			listPriceCents: 137402,
			expectedDaysToSell: 2,
			daysLow: 1,
			daysHigh: 3.5,
			netCents: 7666,
			// cycle $/day = 7666/(11+2) ≈ 590
			dollarsPerDay: 590,
			queueAhead: 1,
			asksAbove: 5,
		},
	},
	evaluation: {
		rating: "buy",
		expectedNetCents: 12506,
		bidCeilingCents: 116666,
		reason: "$1,100 — 23% below the size-9 median ($1,432). AJ1 Mocha sz 9 clears in 5d at p50; $77 net at $1,374 exit ~2 days.",
		safeBidBreakdown: {
			estimatedSaleCents: 137402,
			feesCents: 18236,
			shippingCents: 1500,
			targetNetCents: 3000,
		},
		recommendedExit: { listPriceCents: 137402, expectedDaysToSell: 2, daysLow: 1, daysHigh: 3.5, netCents: 7666, dollarsPerDay: 590, queueAhead: 1, asksAbove: 5 },
	},
	returns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
};

const CANON50_DETAIL: ItemDetail = {
	itemId: "v1|285927416032|0",
	legacyItemId: "285927416032",
	title: "Canon EF 50mm f/1.8 STM Lens — used, with caps",
	itemWebUrl: "https://www.ebay.com/itm/285927416032",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "82.00", currency: "USD" },
	image: { imageUrl: "/demo/canon-50-1.png" },
	images: ["/demo/canon-50-1.png", "/demo/canon-50-2.png", "/demo/canon-50-3.png"],
	brand: "Canon",
	categoryPath: "Cameras & Photo/Lenses & Filters/Lenses",
	categoryId: "78997",
	localizedAspects: [
		{ name: "Brand", value: "Canon" },
		{ name: "Model", value: "EF 50mm f/1.8 STM" },
		{ name: "Mount", value: "Canon EF" },
		{ name: "Maximum Aperture", value: "f/1.8" },
		{ name: "Focal Length", value: "50mm" },
	],
	seller: { username: "lens_swap_pdx", feedbackScore: 3286, feedbackPercentage: "100.0" },
	shippingOptions: [{ shippingCost: { value: "8.00", currency: "USD" } }],
	buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
};

const CANON50_SOLD = [
	sold("c50-1", "Canon EF 50mm f/1.8 STM (used)", 7800, 22),
	sold("c50-2", "Canon 50mm 1.8 STM lens with caps", 8200, 19),
	sold("c50-3", "Canon EF 50/1.8 STM Pre-owned", 8500, 17),
	sold("c50-4", "Canon EF 50mm f/1.8 STM clean", 8700, 14),
	sold("c50-5", "Canon EF 50mm f/1.8 STM EX", 9000, 12),
	sold("c50-6", "Canon 50mm f1.8 STM near mint", 9300, 9),
	sold("c50-7", "Canon EF 50mm 1.8 STM mint w/ box", 9700, 7),
	sold("c50-8", "Canon EF 50mm f/1.8 STM like new", 10100, 5),
	sold("c50-9", "Canon EF 50mm f/1.8 STM mint", 10500, 4),
	sold("c50-10", "Canon EF 50mm f/1.8 STM excellent", 10800, 3),
	sold("c50-11", "Canon EF 50mm f/1.8 STM box + hood", 11200, 2),
	sold("c50-12", "Canon EF 50mm f/1.8 STM sealed-look", 11600, 1),
];

export const MOCK_CANON50: EvaluateFixture = {
	detail: CANON50_DETAIL,
	soldPool: CANON50_SOLD,
	activePool: buildActivePool({ titlePrefix: "Canon EF 50mm f/1.8 STM", centerCents: 9500, spreadCents: 2400, n: 11 }),
	marketSummary: {
		market: {
			keyword: "Canon EF 50mm f/1.8 STM",
			marketplace: "ebay_us",
			windowDays: 30,
			meanCents: 9617,
			stdDevCents: 1158,
			medianCents: 9500,
			medianCiLowCents: 9100,
			medianCiHighCents: 10100,
			p25Cents: 8700,
			p75Cents: 10500,
			nObservations: 38,
			salesPerDay: 1.27,
			meanDaysToSell: 4,
			daysP50: 3,
			daysP70: 6,
			daysP90: 11,
			nDurations: 38,
		},
		listPriceRecommendation: {
			listPriceCents: 9214,
			expectedDaysToSell: 3,
			daysLow: 1.5,
			daysHigh: 5,
			netCents: 920,
			// cycle $/day = 920/(11+3) ≈ 66
			dollarsPerDay: 66,
			queueAhead: 2,
			asksAbove: 4,
		},
	},
	evaluation: {
		rating: "buy",
		// expectedNet on this row is small ($13). With the new $30 default
		// floor this would actually rate "skip" — kept "buy" here because
		// the mock's reseller has set a custom $10 floor (targetNetCents).
		expectedNetCents: 1296,
		bidCeilingCents: 7050,
		reason: "$82 — 14% below the 30-day median ($95). Nifty-fifty clears in 3d at p50; $9 net at $92 exit (custom $10 floor).",
		safeBidBreakdown: {
			estimatedSaleCents: 9214,
			feesCents: 1221,
			shippingCents: 800,
			targetNetCents: 1000,
		},
		recommendedExit: { listPriceCents: 9214, expectedDaysToSell: 3, daysLow: 1.5, daysHigh: 5, netCents: 920, dollarsPerDay: 66, queueAhead: 2, asksAbove: 4 },
	},
	returns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
};

/* ─────────── dispatchers ─────────── */

const FIXTURES_BY_ITEM_ID: Record<string, EvaluateFixture> = {
	"v1|388236252829|0": MOCK_GUCCI,
	"v1|127595526397|0": MOCK_AJ1,
	"v1|285927416032|0": MOCK_CANON50,
};

export function mockEvaluateFixture(itemId: string): EvaluateFixture {
	const hit = FIXTURES_BY_ITEM_ID[itemId];
	if (hit) return hit;
	return {
		...MOCK_GUCCI,
		detail: {
			...MOCK_GUCCI.detail,
			itemId,
			legacyItemId: itemId.replace(/^v1\|/, "").replace(/\|0$/, ""),
		},
	};
}

/** True iff the fixture is real (matches a curated EvaluateFixture), not the
 *  Gucci-clone fallback. Used by the logged-out drawer to gate Run Evaluate
 *  on non-curated reps to /signup instead of showing mismatched data. */
export function hasMockEvaluateFixture(itemId: string): boolean {
	return Object.hasOwn(FIXTURES_BY_ITEM_ID, itemId);
}
