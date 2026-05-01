/**
 * Hand-curated fixtures for the logged-out playground (landing hero).
 * Same shapes the real API returns so the existing Discover/Evaluate UI
 * renders them without a code path of its own.
 *
 * Every numeric field below — market stats, ratings, expectedNet,
 * bidCeiling, recommendedExit, safeBidBreakdown — was produced by the
 * real `services/evaluate/evaluate.ts` pipeline running over each
 * cluster's curated sold pool + active asks. The temp script lives at
 * `packages/api/src/scripts/_compute-mock-quant.ts` (deleted after the
 * paste, recreate with the same shape to refresh).
 *
 *   discover/canon         "Canon" — 4 product clusters
 *   discover/pokemon       "Pokémon Base Set 1st Ed." — 4 cards
 *   evaluate/gucci         Gucci YA1264153 G-Timeless watch
 *   evaluate/aj1           Travis Scott AJ1 Mocha (sz 9)
 *
 * Free-text input in mockMode redirects to /signup.
 */

import type {
	BrowseSearchResponse,
	DealCluster,
	Evaluation,
	ItemDetail,
	ItemSummary,
	MarketStats,
	MarketSummary,
} from "./types";

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

function comp(id: string, title: string, cents: number): ItemSummary {
	return {
		itemId: `v1|${id}|0`,
		title,
		itemWebUrl: `https://www.ebay.com/itm/${id}`,
		condition: "Pre-owned",
		conditionId: "3000",
		price: { value: (cents / 100).toFixed(2), currency: "USD" },
	};
}

function buildCluster(
	rep: ItemSummary,
	evaluation: Evaluation,
	soldSubset: ItemSummary[],
	marketStats: MarketStats,
	categoryPath = "",
	categoryId = "",
	activeComps: ItemSummary[] = [],
): DealCluster {
	const detail: ItemDetail = { ...rep, categoryPath, categoryId };
	const activePool = [rep, ...activeComps];
	return {
		canonical: rep.title,
		source: "singleton",
		count: 1,
		item: detail,
		soldPool: soldSubset,
		activePool,
		rejectedSoldPool: [],
		rejectedActivePool: [],
		market: marketStats,
		evaluation,
		returns: { accepted: true, periodDays: 30 },
		meta: {
			itemSource: "scrape",
			soldCount: soldSubset.length,
			soldSource: "scrape",
			activeCount: activePool.length,
			activeSource: "scrape",
			soldKept: soldSubset.length,
			soldRejected: 0,
			activeKept: activePool.length,
			activeRejected: 0,
		},
	};
}

/* ═════════════════════════════════════════════════════════════════════
 *  DISCOVER #1 — "Canon"
 *  Numbers below are direct outputs of evaluate() over each cluster's
 *  sold pool + active asks. See `_compute-mock-quant.ts` for inputs.
 * ═════════════════════════════════════════════════════════════════════ */

// EF 50mm f/1.8 STM — ask $69.95 vs median $107.50 (~35% under)
const CANON_REP_50MM: ItemSummary = {
	itemId: "v1|377151909505|0",
	title: "Canon EF 50mm f/1.8 STM with both caps — clean glass",
	itemWebUrl: "https://www.ebay.com/itm/377151909505",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "69.95", currency: "USD" },
	image: { imageUrl: "/demo/canon-50-1.png" },
};

const CANON_50MM_COMPS = [
	comp("c50-comp-1", "Canon EF 50mm f/1.8 STM (NM, no caps)", 8499),
	comp("c50-comp-2", "Canon EF 50mm f/1.8 STM Excellent + caps", 8950),
	comp("c50-comp-3", "Canon EF 50mm f/1.8 STM with box", 9495),
	comp("c50-comp-4", "Canon EF 50mm f/1.8 STM Mint", 10500),
	comp("c50-comp-5", "Canon EF 50mm f/1.8 STM Like New + filter", 11500),
	comp("c50-comp-6", "Canon EF 50mm f/1.8 STM Pristine + box", 12895),
];

const CANON_50MM_SOLD = [
	sold("c50-1", "Canon EF 50mm f/1.8 STM (used)", 7950, 28),
	sold("c50-2", "Canon EF 50mm f/1.8 STM caps", 8499, 26),
	sold("c50-3", "Canon EF 50mm f/1.8 STM Black", 8800, 24),
	sold("c50-4", "Canon EF 50mm f/1.8 STM Excellent", 9295, 21),
	sold("c50-5", "Canon EF 50mm f/1.8 STM with box", 9700, 18),
	sold("c50-6", "Canon EF 50mm f/1.8 STM Mint", 10250, 14),
	sold("c50-7", "Canon EF 50mm f/1.8 STM Caps + Box", 10750, 11),
	sold("c50-8", "Canon EF 50mm f/1.8 STM Like New", 11200, 8),
	sold("c50-9", "Canon EF 50mm f/1.8 STM Pristine", 11999, 5),
	sold("c50-10", "Canon EF 50mm f/1.8 STM Sealed-feel", 12500, 3),
];

const CANON_50MM_MARKET: MarketStats = {
	keyword: "Canon EF 50mm f/1.8 STM",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 10827,
	stdDevCents: 1711,
	medianCents: 10750,
	p25Cents: 9500,
	p75Cents: 12200,
	nObservations: 25,
	salesPerDay: 0.83,
	meanDaysToSell: 8,
};

// EF 24-105mm f/4L IS USM — ask $279 vs median $410 (~32% under) — best margin
const CANON_REP_24_105: ItemSummary = {
	itemId: "v1|366364333055|0",
	title: "Canon EF 24-105mm f/4L IS USM — hood + caps + tested",
	itemWebUrl: "https://www.ebay.com/itm/366364333055",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "279.00", currency: "USD" },
	image: { imageUrl: "/demo/canon-24-105.jpg" },
};

const CANON_24_105_COMPS = [
	comp("c24-comp-1", "Canon EF 24-105mm f/4L IS USM (no hood)", 33999),
	comp("c24-comp-2", "Canon EF 24-105mm f/4L IS USM with hood", 36900),
	comp("c24-comp-3", "Canon EF 24-105mm f/4L IS USM Excellent+", 39900),
	comp("c24-comp-4", "Canon EF 24-105mm f/4L IS USM Mint", 42500),
	comp("c24-comp-5", "Canon EF 24-105mm f/4L IS USM Like New", 44999),
	comp("c24-comp-6", "Canon EF 24-105mm f/4L IS USM box + filter", 47900),
];

const CANON_24_105_SOLD = [
	sold("c24-1", "Canon EF 24-105mm f/4L IS USM (used)", 31000, 27),
	sold("c24-2", "Canon EF 24-105mm f/4L IS USM Zoom", 34999, 23),
	sold("c24-3", "Canon EF 24-105mm f/4L IS — clean", 36900, 20),
	sold("c24-4", "Canon EF 24-105mm f/4L IS USM hood", 38500, 16),
	sold("c24-5", "Canon EF 24-105mm f/4L IS USM Mint", 41000, 12),
	sold("c24-6", "Canon EF 24-105mm f/4L IS USM Box", 42500, 9),
	sold("c24-7", "Canon EF 24-105mm f/4L IS USM Like New", 44500, 6),
	sold("c24-8", "Canon EF 24-105mm f/4L IS USM JP-import", 46900, 4),
];

const CANON_24_105_MARKET: MarketStats = {
	keyword: "Canon EF 24-105mm f/4L IS USM",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 40768,
	stdDevCents: 4204,
	medianCents: 41000,
	p25Cents: 37999,
	p75Cents: 44000,
	nObservations: 25,
	salesPerDay: 0.83,
	meanDaysToSell: 12,
};

// RF 50mm f/1.8 STM — at the floor, no margin → SKIP
const CANON_REP_RF_50: ItemSummary = {
	itemId: "v1|287303422868|0",
	title: "Canon RF 50mm F1.8 STM Lens — original box",
	itemWebUrl: "https://www.ebay.com/itm/287303422868",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "165.00", currency: "USD" },
	image: { imageUrl: "/demo/canon-rf-50.jpg" },
};

const CANON_RF_50_COMPS = [
	comp("crf50-comp-1", "Canon RF 50mm f/1.8 STM (NM)", 17500),
	comp("crf50-comp-2", "Canon RF 50mm f/1.8 STM with box", 17999),
	comp("crf50-comp-3", "Canon RF 50mm f/1.8 STM Mint", 18500),
	comp("crf50-comp-4", "Canon RF 50mm f/1.8 STM Pristine", 18900),
	comp("crf50-comp-5", "Canon RF 50mm f/1.8 STM Like New", 19500),
	comp("crf50-comp-6", "Canon RF 50mm f/1.8 STM Sealed", 21500),
];

const CANON_RF_50_SOLD = [
	sold("crf50-1", "Canon RF 50mm f/1.8 STM (used)", 15800, 22),
	sold("crf50-2", "Canon RF 50mm F1.8 STM", 16500, 18),
	sold("crf50-3", "Canon RF 50mm f/1.8 STM Excellent", 17500, 15),
	sold("crf50-4", "Canon RF 50mm f/1.8 STM Box", 18000, 12),
	sold("crf50-5", "Canon RF 50mm f/1.8 STM Mint", 18750, 9),
	sold("crf50-6", "Canon RF 50mm f/1.8 STM Like New", 19500, 6),
	sold("crf50-7", "Canon RF 50mm f/1.8 STM Sealed", 21500, 3),
];

const CANON_RF_50_MARKET: MarketStats = {
	keyword: "Canon RF 50mm f/1.8 STM",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 18677,
	stdDevCents: 1707,
	medianCents: 18625,
	p25Cents: 17275,
	p75Cents: 19937,
	nObservations: 22,
	salesPerDay: 0.73,
	meanDaysToSell: 9,
};

// EOS R6 body — above market with no kit premium → SKIP
const CANON_REP_R6: ItemSummary = {
	itemId: "v1|198060156509|0",
	title: "Canon EOS R6 Mirrorless Camera Body — battery + charger",
	itemWebUrl: "https://www.ebay.com/itm/198060156509",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "1300.00", currency: "USD" },
	image: { imageUrl: "/demo/canon-r6.jpg" },
};

const CANON_R6_COMPS = [
	comp("cr6-comp-1", "Canon EOS R6 Body (used)", 124900),
	comp("cr6-comp-2", "Canon EOS R6 Body 20MP", 127500),
	comp("cr6-comp-3", "Canon EOS R6 Body Mint Box", 128500),
	comp("cr6-comp-4", "Canon EOS R6 Body Excellent+", 132500),
	comp("cr6-comp-5", "Canon EOS R6 Body Like New + extras", 135500),
	comp("cr6-comp-6", "Canon EOS R6 Body Sealed Bracelet", 138900),
];

const CANON_R6_SOLD = [
	sold("cr6-1", "Canon EOS R6 Body (used)", 106857, 24),
	sold("cr6-2", "Canon EOS R6 Body 20MP", 113000, 21),
	sold("cr6-3", "Canon EOS R6 Body battery", 116850, 17),
	sold("cr6-4", "Canon EOS R6 Body 20.1MP", 119800, 14),
	sold("cr6-5", "Canon EOS R6 Body Excellent+", 124000, 11),
	sold("cr6-6", "Canon EOS R6 Body Mint Box", 128500, 8),
	sold("cr6-7", "Canon EOS R6 Body Excellent", 132500, 5),
	sold("cr6-8", "Canon EOS R6 Body Like New", 138000, 3),
];

const CANON_R6_MARKET: MarketStats = {
	keyword: "Canon EOS R6 body",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 122783,
	stdDevCents: 8367,
	medianCents: 123000,
	p25Cents: 116175,
	p75Cents: 129150,
	nObservations: 23,
	salesPerDay: 0.77,
	meanDaysToSell: 14,
};

const CANON_CLUSTERS: DealCluster[] = [
	// EF 50mm STM — BUY $15.67 net, exit $101.61 in ~19d
	buildCluster(
		CANON_REP_50MM,
		{
			rating: "buy",
			expectedNetCents: 1567,
			bidCeilingCents: 6985,
			confidence: 0.96,
			reason: "$69.95 — 35% below median ($107.50) and below all 6 competing asks (next-cheapest $84.99). Hazard model exits at $101.61 in ~19 days.",
			signals: [
				{ name: "under_median", reason: "Asking 35% below the 30-day median ($107.50)." },
				{ name: "below_asks", reason: "Lowest of 7 active asks; next ask is $14.54 higher." },
				{ name: "fresh_listing", reason: "Posted in the last 24h — first sub-$80 ask in the cohort this week." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 10161,
				feesCents: 1376,
				shippingCents: 800,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 10161, expectedDaysToSell: 19, netCents: 990, dollarsPerDay: 53 },
		},
		CANON_50MM_SOLD,
		CANON_50MM_MARKET,
		"Cameras & Photo/Lenses & Filters/Lenses",
		"3323",
		CANON_50MM_COMPS,
	),
	// EF 24-105L — BUY $60.36 net, exit $386.66 in ~10d (best margin)
	buildCluster(
		CANON_REP_24_105,
		{
			rating: "buy",
			expectedNetCents: 6036,
			bidCeilingCents: 31113,
			confidence: 0.96,
			reason: "$279 vs $410 median — 32% under, with hood + caps. L-glass clears p70 in 10 days; $42 net at the recommended $387 exit.",
			signals: [
				{ name: "under_median", reason: "Asking 32% below the 30-day median ($410)." },
				{ name: "below_asks", reason: "Lowest of 7 active asks; the next is $339.99 (no hood)." },
				{ name: "complete_kit", reason: "Hood + caps included — adds $30–40 vs bare-body comps." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 38666,
				feesCents: 5153,
				shippingCents: 1400,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 38666, expectedDaysToSell: 10, netCents: 4213, dollarsPerDay: 425 },
		},
		CANON_24_105_SOLD,
		CANON_24_105_MARKET,
		"Cameras & Photo/Lenses & Filters/Lenses",
		"3323",
		CANON_24_105_COMPS,
	),
	// RF 50mm STM — SKIP, expectedNet -$12 (below $10 floor)
	buildCluster(
		CANON_REP_RF_50,
		{
			rating: "skip",
			expectedNetCents: -1228,
			bidCeilingCents: 15309,
			confidence: 0.96,
			reason: "Lowest ask, but the spread is too thin: $21 to median, fees + ship eat $36. Hazard model can't find a profitable exit under 60 days.",
			signals: [
				{ name: "under_median", reason: "Asking 11% below median — narrow." },
				{ name: "below_asks", reason: "Lowest of 7 active asks." },
				{ name: "fees_dominate", reason: "13.25% fee on $186 sale = $25; ship-out $9 — eats the spread." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 19872,
				feesCents: 2663,
				shippingCents: 900,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 19872, expectedDaysToSell: 172, netCents: -191, dollarsPerDay: -1 },
		},
		CANON_RF_50_SOLD,
		CANON_RF_50_MARKET,
		"Cameras & Photo/Lenses & Filters/Lenses",
		"3323",
		CANON_RF_50_COMPS,
	),
	// R6 — SKIP, $260 negative net
	buildCluster(
		CANON_REP_R6,
		{
			rating: "skip",
			expectedNetCents: -26016,
			bidCeilingCents: 110969,
			confidence: 0.96,
			reason: "Above median with no kit premium. Recent comps with battery + charger cleared $1,230 — this asks $70 more for the same. Body-only exits all losing.",
			signals: [
				{ name: "above_median", reason: "Asking 6% above the 30-day median ($1,230)." },
				{ name: "no_premium", reason: "Body-only ask matches box+kit comps — no upgrade path." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 131987,
				feesCents: 17518,
				shippingCents: 2500,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 131987, expectedDaysToSell: 170, netCents: -18031, dollarsPerDay: -106 },
		},
		CANON_R6_SOLD,
		CANON_R6_MARKET,
		"Cameras & Photo/Digital Cameras",
		"31388",
		CANON_R6_COMPS,
	),
];

export const MOCK_CANON = {
	search: {
		itemSummaries: [CANON_REP_50MM, CANON_REP_24_105, CANON_REP_RF_50, CANON_REP_R6],
		total: 142,
	} satisfies BrowseSearchResponse,
	sold: {
		itemSales: [...CANON_50MM_SOLD, ...CANON_24_105_SOLD, ...CANON_RF_50_SOLD, ...CANON_R6_SOLD],
		total: 95,
	} satisfies BrowseSearchResponse,
	clusters: CANON_CLUSTERS,
};

/* ═════════════════════════════════════════════════════════════════════
 *  DISCOVER #2 — "Pokémon Base Set 1st Ed."
 * ═════════════════════════════════════════════════════════════════════ */

// Charizard Base Set Holo 4/102 — ask $135 vs median $265 → BUY
const POKE_REP_CHARIZARD: ItemSummary = {
	itemId: "v1|174721237929|0",
	title: "Pokémon 1999 Charizard 4/102 Holo Base Set (LP) — clean centering",
	itemWebUrl: "https://www.ebay.com/itm/174721237929",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "135.00", currency: "USD" },
	image: { imageUrl: "/demo/charizard-base-holo.jpg" },
};

const CHARIZARD_BASE_COMPS = [
	comp("zb-comp-1", "Charizard 4/102 Base Set Holo (LP-NM)", 18500),
	comp("zb-comp-2", "Pokémon Charizard 4/102 Holo", 23000),
	comp("zb-comp-3", "Charizard Base Set Holo (NM)", 26500),
	comp("zb-comp-4", "Charizard 4/102 Base Set Holo Mint", 30000),
	comp("zb-comp-5", "Charizard Base Set Holo NM-Mint", 38900),
	comp("zb-comp-6", "Charizard 4/102 Base Set PSA 7", 47500),
];

const CHARIZARD_BASE_SOLD = [
	sold("zb-1", "Charizard 4/102 Base Set Holo (PL)", 14500, 22),
	sold("zb-2", "Charizard Base Set Holo 4/102", 17500, 19),
	sold("zb-3", "Charizard Base Set Holo (LP)", 19500, 16),
	sold("zb-4", "Charizard 4/102 Base Set Holo", 22500, 13),
	sold("zb-5", "Charizard Base Set Holo (LP-NM)", 25500, 10),
	sold("zb-6", "Pokémon Charizard 4/102 Holo", 28000, 8),
	sold("zb-7", "Charizard Base Set Holo (NM)", 31000, 6),
	sold("zb-8", "Charizard 4/102 Base Set PSA 7", 38900, 4),
	sold("zb-9", "Charizard Base Set Holo NM-Mint", 41500, 2),
	sold("zb-10", "Charizard 4/102 Base Set PSA 8", 47500, 1),
];

const CHARIZARD_BASE_MARKET: MarketStats = {
	keyword: "Charizard Base Set Holo 4/102",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 27776,
	stdDevCents: 8619,
	medianCents: 26500,
	p25Cents: 21500,
	p75Cents: 32500,
	nObservations: 25,
	salesPerDay: 0.83,
	meanDaysToSell: 11,
};

// Blastoise Base Set 2/102 — ask $69 vs median $127 → BUY
const POKE_REP_BLASTOISE: ItemSummary = {
	itemId: "v1|255644499451|0",
	title: "Pokémon Blastoise 2/102 Base Set Holo (NM) — square-cut centering",
	itemWebUrl: "https://www.ebay.com/itm/255644499451",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "69.00", currency: "USD" },
	image: { imageUrl: "/demo/blastoise.jpg" },
};

const BLASTOISE_COMPS = [
	comp("bl-comp-1", "Blastoise 2/102 Base Set Holo (LP)", 8900),
	comp("bl-comp-2", "Blastoise Base Set Holo 2/102", 9900),
	comp("bl-comp-3", "Blastoise 2/102 Base Set Holo NM", 11500),
	comp("bl-comp-4", "Blastoise Base Set Holo Mint", 13900),
	comp("bl-comp-5", "Blastoise 2/102 NM-Mint", 15900),
	comp("bl-comp-6", "Blastoise 2/102 PSA 7", 19900),
];

const BLASTOISE_SOLD = [
	sold("bl-1", "Blastoise 2/102 Base Set Holo (LP)", 7900, 21),
	sold("bl-2", "Blastoise Base Set Holo 2/102", 8900, 18),
	sold("bl-3", "Blastoise 2/102 Base Set Holo", 9900, 15),
	sold("bl-4", "Blastoise Base Set Holo Unlimited", 10900, 13),
	sold("bl-5", "Blastoise 2/102 Holo (NM)", 11900, 10),
	sold("bl-6", "Blastoise Base Set 2/102", 12900, 8),
	sold("bl-7", "Blastoise Base Set Holo NM", 13900, 6),
	sold("bl-8", "Blastoise 2/102 NM-Mint", 14900, 4),
	sold("bl-9", "Blastoise Base Set Holo Mint", 16500, 2),
	sold("bl-10", "Blastoise 2/102 PSA 7", 19900, 1),
];

const BLASTOISE_MARKET: MarketStats = {
	keyword: "Blastoise Base Set Holo 2/102",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 13055,
	stdDevCents: 3300,
	medianCents: 12700,
	p25Cents: 10600,
	p75Cents: 15350,
	nObservations: 22,
	salesPerDay: 0.73,
	meanDaysToSell: 12,
};

// Machamp 1st Ed Holo — at p25, expectedNet -$3.63 → SKIP
const POKE_REP_MACHAMP: ItemSummary = {
	itemId: "v1|385341232479|0",
	title: "Pokémon Machamp 1st Edition Holo 8/102 Base Set (NM)",
	itemWebUrl: "https://www.ebay.com/itm/385341232479",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "95.00", currency: "USD" },
	image: { imageUrl: "/demo/machamp-1st-ed.jpg" },
};

const MACHAMP_COMPS = [
	comp("ma-comp-1", "Machamp 1st Ed Holo 8/102 (NM)", 11000),
	comp("ma-comp-2", "Machamp 1st Edition Holo NM", 12000),
	comp("ma-comp-3", "Machamp 1st Ed Holo Mint", 13500),
	comp("ma-comp-4", "Machamp 1st Ed Holo PSA 8", 14900),
	comp("ma-comp-5", "Machamp 1st Ed Holo PSA 9", 17900),
];

const MACHAMP_SOLD = [
	sold("ma-1", "Machamp 1st Ed Holo (LP)", 7900, 24),
	sold("ma-2", "Machamp 1st Ed Holo 8/102", 8500, 21),
	sold("ma-3", "Machamp 1st Edition Holo", 9500, 18),
	sold("ma-4", "Machamp 1st Ed Holo (NM)", 10500, 15),
	sold("ma-5", "Machamp 1st Edition 8/102 Holo", 11000, 12),
	sold("ma-6", "Machamp 1st Ed Holo NM", 12000, 10),
	sold("ma-7", "Machamp 1st Ed Holo NM-Mint", 13000, 7),
	sold("ma-8", "Machamp 1st Ed Holo Mint", 14000, 4),
	sold("ma-9", "Machamp 1st Ed PSA 8", 15900, 2),
];

const MACHAMP_MARKET: MarketStats = {
	keyword: "Machamp 1st Edition Holo 8/102",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 11143,
	stdDevCents: 2354,
	medianCents: 11000,
	p25Cents: 9500,
	p75Cents: 12800,
	nObservations: 21,
	salesPerDay: 0.70,
	meanDaysToSell: 15,
};

// Charizard Shadowless raw — SKIP, grading is the only path
const POKE_REP_CHARIZARD_SHADOWLESS: ItemSummary = {
	itemId: "v1|264895026705|0",
	title: "Pokémon Base Set Shadowless Charizard 4/102 (raw)",
	itemWebUrl: "https://www.ebay.com/itm/264895026705",
	condition: "Pre-owned",
	conditionId: "3000",
	price: { value: "1250.00", currency: "USD" },
	image: { imageUrl: "/demo/charizard-shadowless.jpg" },
};

const CHARIZARD_SHADOWLESS_COMPS = [
	comp("zsh-comp-1", "Pokémon Shadowless Charizard 4/102 (NM)", 142200),
	comp("zsh-comp-2", "Charizard Shadowless 4/102 BGS 7", 162500),
	comp("zsh-comp-3", "Charizard Shadowless 4/102 PSA 6", 173500),
	comp("zsh-comp-4", "Charizard Shadowless PSA 7", 195000),
	comp("zsh-comp-5", "Charizard Shadowless 4/102 PSA 8", 245000),
];

const CHARIZARD_SHADOWLESS_SOLD = [
	sold("zsh-1", "Charizard Shadowless Base Set 4/102 (LP)", 85000, 28),
	sold("zsh-2", "Charizard Shadowless 4/102 (LP-NM)", 102000, 24),
	sold("zsh-3", "Pokémon Shadowless Charizard 4/102", 113000, 20),
	sold("zsh-4", "Charizard Shadowless Base Set", 122500, 17),
	sold("zsh-5", "Charizard Shadowless 4/102 (NM)", 130000, 14),
	sold("zsh-6", "Charizard Shadowless Holo NM-Mint", 139900, 10),
	sold("zsh-7", "Charizard Shadowless 4/102 PSA 6", 145000, 7),
	sold("zsh-8", "Charizard Shadowless PSA 7", 152500, 4),
];

const CHARIZARD_SHADOWLESS_MARKET: MarketStats = {
	keyword: "Charizard Shadowless 4/102",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 122290,
	stdDevCents: 18703,
	medianCents: 123750,
	p25Cents: 108750,
	p75Cents: 136225,
	nObservations: 20,
	salesPerDay: 0.67,
	meanDaysToSell: 19,
};

const POKEMON_CLUSTERS: DealCluster[] = [
	// Charizard Holo — BUY $100.66 net, exit $234.67 in ~4d
	buildCluster(
		POKE_REP_CHARIZARD,
		{
			rating: "buy",
			expectedNetCents: 10066,
			bidCeilingCents: 18828,
			confidence: 0.96,
			reason: "$135 LP — 49% below median ($265). Lowest of 7 active asks ($50 below the next). Hazard model exits at $235 in 4 days; $63 net.",
			signals: [
				{ name: "under_median", reason: "Asking 49% below the 30-day median ($265)." },
				{ name: "below_asks", reason: "Lowest of 7 active asks; next is $185." },
				{ name: "demand_pulse", reason: "0.83 sales/day for Base Set Holo — clears p70 in 4–6 days." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 23467,
				feesCents: 3139,
				shippingCents: 500,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 23467, expectedDaysToSell: 4, netCents: 6328, dollarsPerDay: 1473 },
		},
		CHARIZARD_BASE_SOLD,
		CHARIZARD_BASE_MARKET,
		"Toys & Hobbies/Collectible Card Games/Pokémon TCG/Pokémon Individual Cards",
		"183454",
		CHARIZARD_BASE_COMPS,
	),
	// Blastoise NM — BUY $38.95 net, exit $106.28 in ~5d
	buildCluster(
		POKE_REP_BLASTOISE,
		{
			rating: "buy",
			expectedNetCents: 3895,
			bidCeilingCents: 7690,
			confidence: 0.96,
			reason: "$69 NM — 46% below median ($127). Lowest of 7 asks. Blastoise pace is slower than Charizard but $58 spread is real after fees.",
			signals: [
				{ name: "under_median", reason: "Asking 46% below the 30-day median ($127)." },
				{ name: "below_asks", reason: "Lowest of 7 active asks; next ask is $89." },
				{ name: "grade_arbitrage", reason: "NM listing at LP-grade pricing — possible photo undersell." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 10628,
				feesCents: 1438,
				shippingCents: 500,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 10628, expectedDaysToSell: 5, netCents: 1790, dollarsPerDay: 382 },
		},
		BLASTOISE_SOLD,
		BLASTOISE_MARKET,
		"Toys & Hobbies/Collectible Card Games/Pokémon TCG/Pokémon Individual Cards",
		"183454",
		BLASTOISE_COMPS,
	),
	// Machamp — SKIP, expectedNet -$3.63 (below $10 floor)
	buildCluster(
		POKE_REP_MACHAMP,
		{
			rating: "skip",
			expectedNetCents: -363,
			bidCeilingCents: 8834,
			confidence: 0.96,
			reason: "At p25 — fees + ship eat the spread. Wait for sub-$80 ask, or pivot to grading: PSA 8 comps clear $159 ($35 grade fee + 30d).",
			signals: [
				{ name: "below_asks", reason: "Lowest of 6 active asks." },
				{ name: "fees_dominate", reason: "$119 sale → $16 fees + $5 ship; spread to median is $15." },
				{ name: "grading_path", reason: "PSA 8 ceiling is $159 — $35 grade + 30d for $40+ premium." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 11947,
				feesCents: 1613,
				shippingCents: 500,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 11947, expectedDaysToSell: 23, netCents: 334, dollarsPerDay: 15 },
		},
		MACHAMP_SOLD,
		MACHAMP_MARKET,
		"Toys & Hobbies/Collectible Card Games/Pokémon TCG/Pokémon Individual Cards",
		"183454",
		MACHAMP_COMPS,
	),
	// Charizard Shadowless raw — SKIP, raw at median is dead money
	buildCluster(
		POKE_REP_CHARIZARD_SHADOWLESS,
		{
			rating: "skip",
			expectedNetCents: -21443,
			bidCeilingCents: 128873,
			confidence: 0.96,
			reason: "Raw at median is dead money. Margin path requires PSA 8+ ($2,450+) but odds from listing photos look ~30%; $35 grade + 60d timeline doesn't justify the bid.",
			signals: [
				{ name: "raw_ceiling", reason: "Raw NM ceiling is ~$1,400. Asking $1,250 leaves $150 gross before fees." },
				{ name: "grading_risk", reason: "PSA 8 jumps to $2,450 — but odds from photos look ~30%." },
				{ name: "slow_pace", reason: "0.67 sales/day at this tier — 19d median, 35d at p90." },
			],
			safeBidBreakdown: {
				estimatedSaleCents: 152626,
				feesCents: 20253,
				shippingCents: 2500,
				targetNetCents: 1000,
			},
			recommendedExit: { listPriceCents: 152626, expectedDaysToSell: 95, netCents: 4873, dollarsPerDay: 51 },
		},
		CHARIZARD_SHADOWLESS_SOLD,
		CHARIZARD_SHADOWLESS_MARKET,
		"Toys & Hobbies/Collectible Card Games/Pokémon TCG/Pokémon Individual Cards",
		"183454",
		CHARIZARD_SHADOWLESS_COMPS,
	),
];

export const MOCK_POKEMON = {
	search: {
		itemSummaries: [POKE_REP_CHARIZARD, POKE_REP_BLASTOISE, POKE_REP_MACHAMP, POKE_REP_CHARIZARD_SHADOWLESS],
		total: 89,
	} satisfies BrowseSearchResponse,
	sold: {
		itemSales: [...CHARIZARD_BASE_SOLD, ...BLASTOISE_SOLD, ...MACHAMP_SOLD, ...CHARIZARD_SHADOWLESS_SOLD],
		total: 88,
	} satisfies BrowseSearchResponse,
	clusters: POKEMON_CLUSTERS,
};

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
			sellProb7d: 0.62,
			sellProb14d: 0.85,
			sellProb30d: 0.97,
			netCents: 6949,
			dollarsPerDay: 12.59,
			annualizedRoi: 1.84,
		},
	},
	evaluation: {
		rating: "buy",
		expectedNetCents: 9932,
		bidCeilingCents: 55849,
		confidence: 0.96,
		reason: "$499 — 29% below median ($705) with full bracelet kit. Lowest of 6 asks; $99 net at $667 exit, ~6 days. Best Offer enabled.",
		signals: [
			{ name: "under_median", reason: "Asking 29% below the 30-day median ($705)." },
			{ name: "below_asks", reason: "Lowest of 6 active asks; next ask is $620." },
			{ name: "fast_pace", reason: "1.03 sales/day for this ref — 6d median, 14d at p70." },
			{ name: "best_offer", reason: "Best Offer enabled — historical accept rate ~$480 on this ref." },
			{ name: "complete_kit", reason: "Full stainless bracelet — premium vs leather conversions." },
		],
		safeBidBreakdown: {
			estimatedSaleCents: 66714,
			feesCents: 8870,
			shippingCents: 995,
			targetNetCents: 1000,
		},
		recommendedExit: { listPriceCents: 66714, expectedDaysToSell: 6, netCents: 6949, dollarsPerDay: 1259 },
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
			sellProb7d: 0.78,
			sellProb14d: 0.94,
			sellProb30d: 0.99,
			netCents: 7666,
			dollarsPerDay: 38.33,
			annualizedRoi: 4.16,
		},
	},
	evaluation: {
		rating: "buy",
		expectedNetCents: 12506,
		bidCeilingCents: 116666,
		confidence: 0.96,
		reason: "$1,100 — 23% below the size-9 median ($1,432). AJ1 Mocha sz 9 clears in 5d at p50; $77 net at $1,374 exit ~2 days.",
		signals: [
			{ name: "size_matched", reason: "Sold pool filtered to size 9 — 26 same-size sales (30d), median $1,432." },
			{ name: "under_median", reason: "Asking 23% below the size-9 median." },
			{ name: "fast_pace", reason: "0.87 sales/day in size 9 — 5d median, 8d at p70." },
			{ name: "below_asks", reason: "Lowest of 6 active asks; next ask is $1,250." },
			{ name: "best_offer", reason: "Best Offer enabled — historic accept rate ~$1,050 on this colorway." },
		],
		safeBidBreakdown: {
			estimatedSaleCents: 137402,
			feesCents: 18236,
			shippingCents: 1500,
			targetNetCents: 1000,
		},
		recommendedExit: { listPriceCents: 137402, expectedDaysToSell: 2, netCents: 7666, dollarsPerDay: 6294 },
	},
	returns: { accepted: true, periodDays: 30, shippingCostPaidBy: "BUYER" },
};

/* ─────────── dispatchers ─────────── */

export type DiscoverInputs = { q: string; categoryId?: string };

export function mockDiscoverFixture(inputs: DiscoverInputs): typeof MOCK_CANON {
	const q = inputs.q.toLowerCase();
	if (
		inputs.categoryId === "183454" ||
		/charizard|pokemon|pok[eé]mon|base set|blastoise|venusaur/i.test(q)
	) {
		return MOCK_POKEMON;
	}
	return MOCK_CANON;
}

const FIXTURES_BY_ITEM_ID: Record<string, EvaluateFixture> = {
	"v1|388236252829|0": MOCK_GUCCI,
	"v1|127595526397|0": MOCK_AJ1,
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

// Legacy alias — pipelines.ts may still import MOCK_DISCOVER on older paths.
export const MOCK_DISCOVER = MOCK_CANON;
