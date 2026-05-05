/**
 * Canned simulation scripts for the landing-hero agent (logged-out
 * visitors). Each script shadows what the live `/v1/agent/messages`
 * stream would emit for one of the example-chip prompts: tool-start
 * shimmer → tool-end (with UI hint, mounting the same MCP-Apps embed
 * iframe the live agent uses) → text reply, all routed through the
 * same `updateAssistant` patch helper that the real stream uses, so
 * the surface looks indistinguishable from the production flow.
 *
 * Realism comes from real eBay data — itemIds / titles / images we've
 * actually pulled in dev — and from the rendering primitives already in
 * the chat (MarkdownLite, tool-status shimmer, ChatIframe + the
 * `/embed/*` panels).
 */

interface UiHint {
	resourceUri: string;
	props?: Record<string, unknown>;
	mimeType?: string;
}

export interface MockEventToolStart {
	kind: "tool_start";
	/** Exact tool name — feeds toolStatusLabel() in PlaygroundAgent for
	 *  the shimmer label ("Searching listings", "Evaluating", …). */
	name: string;
	delayMs?: number;
}
export interface MockEventToolEnd {
	kind: "tool_end";
	/** Optional MCP-Apps UI hint to mount on the assistant bubble (a
	 *  ChatIframe that loads `/embed/<kind>` and gets `props` posted
	 *  via `embed-init`). When present, the embed panel becomes the
	 *  primary deliverable for that tool — markdown text below
	 *  contextualizes it. */
	ui?: UiHint;
	delayMs?: number;
}
export interface MockEventText {
	kind: "text";
	delta: string;
	delayMs?: number;
}
export interface MockEventDone {
	kind: "done";
	/** Final assistant message body. Replaces any partial text. */
	reply: string;
	delayMs?: number;
}
export type MockEvent =
	| MockEventToolStart
	| MockEventToolEnd
	| MockEventText
	| MockEventDone;

export interface MockScript {
	/** Trim-and-equality match on user input. The first script whose
	 *  prompt matches the user's send fires; anything else falls through
	 *  to the sign-in CTA stub. */
	prompt: string;
	events: MockEvent[];
}

/* ------------------------------ data ------------------------------- */

const CANON_EF_50_IMG = "/demo/canon-50-1.png";
const JORDAN_4_IMG = "https://i.ebayimg.com/images/g/k9oAAeSw6Ydp-AEy/s-l500.webp";
const LEGO_HOGWARTS_IMG = "https://i.ebayimg.com/images/g/ULgAAeSw8iBp-lcz/s-l500.jpg";
const LEGO_BRICKHEADZ_IMG = "https://i.ebayimg.com/images/g/10YAAeSwgAxp-Pwp/s-l500.jpg";
const LEGO_TRIWIZARD_IMG = "https://i.ebayimg.com/images/g/XY4AAeSwI8dp6Xyn/s-l500.jpg";
const LEGO_R2D2_IMG = "https://i.ebayimg.com/images/g/mqoAAeSw0k5p-mAs/s-l500.jpg";
const LEGO_GWP_IMG = "https://i.ebayimg.com/images/g/ZzgAAeSwbodpt1~p/s-l500.jpg";

/* ------------------- search-results UI payloads -------------------- */

// Mirrors the eBay-shape `ItemSummary[]` the EmbedSearchResults panel
// expects under `props.items` — same fields the live tool returns.
// Real listings pulled from production search; retired-sealed LEGO
// is the canonical landing demo because results are reliably abundant
// (the live tool returns ~50k+ matches under $50) and the margin math
// is recognizable to any reseller.
const LEGO_SEARCH_ITEMS = [
	{
		id: "188352164850",
		title: "LEGO Harry Potter: Hogwarts: Grand Staircase (40577) Retired Set Sealed",
		url: "https://www.ebay.com/itm/188352164850",
		price: { value: 7000, currency: "USD" },
		condition: "Brand New",
		images: [LEGO_HOGWARTS_IMG],
		shipping: { cost: { value: 1250, currency: "USD" } },
		seller: { username: "mvea_pop", feedbackPercentage: "99.8" },
	},
	{
		id: "147293996962",
		title: "LEGO Jurassic World BrickHeadz Owen & Blue 41614 Retired Set Sealed in Box",
		url: "https://www.ebay.com/itm/147293996962",
		price: { value: 2999, currency: "USD" },
		condition: "Brand New",
		images: [LEGO_BRICKHEADZ_IMG],
		shipping: { cost: { value: 806, currency: "USD" } },
		seller: { username: "rare_brick_finds", feedbackPercentage: "100" },
	},
	{
		id: "318189811284",
		title: "LEGO 76440 Triwizard Tournament: The Arrival, Retired Set, New Sealed in Box!",
		url: "https://www.ebay.com/itm/318189811284",
		price: { value: 12499, currency: "USD" },
		condition: "Brand New",
		images: [LEGO_TRIWIZARD_IMG],
		shipping: { cost: { value: 0, currency: "USD" } },
		seller: { username: "brickbazaar", feedbackPercentage: "99.6" },
	},
	{
		id: "127848422512",
		title: "LEGO Star Wars: R2-D2 (75308) Brand New Factory Sealed Retired Set",
		url: "https://www.ebay.com/itm/127848422512",
		price: { value: 19995, currency: "USD" },
		condition: "Brand New",
		images: [LEGO_R2D2_IMG],
		shipping: { cost: { value: 1495, currency: "USD" } },
		seller: { username: "north_brick_co", feedbackPercentage: "99.9" },
	},
	{
		id: "406771287113",
		title: "LEGO GWP Promotional Sealed Polybag Lot — Retired Limited Edition Pick",
		url: "https://www.ebay.com/itm/406771287113",
		price: { value: 1990, currency: "USD" },
		condition: "Brand New",
		images: [LEGO_GWP_IMG],
		shipping: { cost: { value: 0, currency: "USD" } },
		seller: { username: "polybag_vault", feedbackPercentage: "100" },
	},
];

/* ------------ evaluate outcome (Canon, full Partial<EvaluateOutcome>) ------------- */

/**
 * Synthesize an `ItemSummary` for the histogram pool. Just enough fields
 * for `<PriceHistogram>` (price.value + image) plus an itemWebUrl so any
 * eventual click-through wouldn't 404 in dev.
 */
function comp(idCounter: number, dollars: number) {
	return {
		itemId: `v1|comp${idCounter}|0`,
		title: "Canon EF 50mm f/1.8 STM",
		itemWebUrl: "https://www.ebay.com/sch/i.html?_nkw=canon+ef+50mm+1.8+stm",
		condition: "Pre-Owned",
		price: { value: dollars.toFixed(2), currency: "USD" },
		image: { imageUrl: CANON_EF_50_IMG },
	};
}

const CANON_SOLD_PRICES = [58, 65, 67, 70, 72, 75, 78, 82, 84, 86, 87, 88, 89, 91, 94, 97, 100, 103, 105, 108, 112, 117, 122, 130, 145];
const CANON_ACTIVE_PRICES = [68, 72, 78, 85, 88, 92, 95, 98, 102, 108, 115, 125, 140, 155];

const CANON_SOLD_POOL = CANON_SOLD_PRICES.map((p, i) => comp(i + 1, p));
const CANON_ACTIVE_POOL = CANON_ACTIVE_PRICES.map((p, i) => comp(i + 100, p));

// Mirrors the playground's `EvaluateOutcome` shape exactly. Field for
// field — the embed feeds this straight into <EvaluateResultBody>.
const CANON_EVALUATE_OUTCOME = {
	item: {
		itemId: "v1|377151909505|0",
		legacyItemId: "377151909505",
		title: "Canon EF 50mm f/1.8 STM · used · with caps",
		itemWebUrl: "https://www.ebay.com/itm/377151909505",
		condition: "Pre-Owned",
		conditionId: "3000",
		price: { value: "42.00", currency: "USD" },
		image: { imageUrl: CANON_EF_50_IMG },
		images: [CANON_EF_50_IMG],
		brand: "Canon",
		categoryPath: "Cameras & Photo|Lenses & Filters|Lenses",
		shippingOptions: [{ shippingCost: { value: "9.99", currency: "USD" } }],
		seller: { username: "vintage_optics", feedbackPercentage: "99.6", feedbackScore: 4823 },
	},
	soldPool: CANON_SOLD_POOL,
	activePool: CANON_ACTIVE_POOL,
	rejectedSoldPool: [],
	rejectedActivePool: [],
	rejectionReasons: {},
	market: {
		keyword: "canon ef 50mm 1.8 stm",
		marketplace: "EBAY_US",
		windowDays: 30,
		meanCents: 9320,
		stdDevCents: 1980,
		medianCents: 8700,
		medianCiLowCents: 8400,
		medianCiHighCents: 9000,
		p25Cents: 7400,
		p75Cents: 10500,
		nObservations: CANON_SOLD_POOL.length,
		salesPerDay: 1.4,
		meanDaysToSell: 11,
		daysStdDev: 6,
		daysP50: 9,
		daysP70: 14,
		daysP90: 26,
		nDurations: CANON_SOLD_POOL.length,
		asks: {
			meanCents: 10080,
			stdDevCents: 2400,
			medianCents: 9750,
			p25Cents: 8500,
			p75Cents: 11500,
			nActive: CANON_ACTIVE_POOL.length,
		},
	},
	evaluation: {
		rating: "buy" as const,
		reason: "Steady margin, lots of recent sales to compare against, prices flat for 2 weeks.",
		expectedNetCents: 1498,
		bidCeilingCents: 7100,
		confidence: 0.84,
		netRangeCents: { p10Cents: 800, p90Cents: 2100 },
		signals: [
			{ name: "thick_comp_pool", reason: "n=25 sold last 30d; std dev tight", weight: 0.7 },
			{ name: "flat_trend", reason: "14-day price change ±0%", weight: 0.5 },
		],
		safeBidBreakdown: {
			feesCents: 1153,
			shippingCents: 850,
			estimatedSaleCents: 8700,
			targetNetCents: 0,
		},
		recommendedExit: {
			listPriceCents: 8700,
			expectedDaysToSell: 9,
			sellProb7d: 0.42,
			sellProb14d: 0.71,
			sellProb30d: 0.92,
			netCents: 1498,
			dollarsPerDay: 166,
		},
	},
	returns: {
		accepted: true,
		periodDays: 30,
		shippingCostPayer: "buyer",
	},
	meta: {
		soldKept: CANON_SOLD_POOL.length,
		soldRejected: 0,
		soldCount: CANON_SOLD_POOL.length,
		soldSource: "scrape",
		activeKept: CANON_ACTIVE_POOL.length,
		activeRejected: 0,
		activeCount: CANON_ACTIVE_POOL.length,
		activeSource: "scrape",
		itemSource: "scrape",
	},
};

/* ------------------------------ scripts ----------------------------- */

// One tool call per script keeps the surface stable: tool_start mounts
// the iframe with an empty props skeleton, tool_end (~1.4s later, enough
// time for the iframe to load + handshake) lands the real props, then
// `done` writes the markdown verdict. No mid-flight label flicker.
const LEGO_FLIP: MockScript = {
	prompt: "Find sealed LEGO retired sets under $50 worth flipping.",
	events: [
		{ kind: "tool_start", name: "flipagent_search_items", delayMs: 600 },
		{
			kind: "tool_end",
			delayMs: 1400,
			ui: {
				resourceUri: "ui://flipagent/search-results",
				props: {
					query: "lego retired set sealed",
					items: LEGO_SEARCH_ITEMS,
					total: 54000,
					source: "scrape",
					args: { limit: 5, priceMax: 5000 },
				},
			},
		},
		{
			kind: "done",
			delayMs: 500,
			reply: [
				"54,000 retired sealed sets matched — top 5 above. Two stand out as clean flips at this price range.",
				"",
				"- **Hogwarts Grand Staircase (40577)** — $70 + $12.50 ship. Sold-pool median around **$110**, ~12 sales/wk. Net **+$15** after fees, ~9 days to sell.",
				"- **Jurassic World BrickHeadz Owen & Blue (41614)** — $29.99 + $8.06 ship. Retired GWP-tier, sold-pool around **$60**. Net **+$8**, faster turnover (~5 days).",
				"- **Triwizard Tournament (76440)** — $124.99 over the $50 cap; surfaced because relevance scored it high. Skip.",
				"",
				"Want me to evaluate any of these in detail, or rerun with a $40+ margin filter?",
			].join("\n"),
		},
	],
};

const CANON_FLIP: MockScript = {
	prompt: "Is https://www.ebay.com/itm/377151909505 worth flipping?",
	events: [
		{ kind: "tool_start", name: "flipagent_evaluate_item", delayMs: 600 },
		{
			kind: "tool_end",
			delayMs: 1700,
			ui: {
				resourceUri: "ui://flipagent/evaluate",
				props: {
					jobId: "demo-canon",
					status: "completed",
					outcome: CANON_EVALUATE_OUTCOME,
				},
			},
		},
		{
			kind: "done",
			delayMs: 500,
			reply: [
				"**Yes — worth buying.** All-in cost is $52 (item + shipping). It usually resells around **$87**, so you'd net about **+$15 profit** after fees.",
				"",
				"Prices have held steady the past two weeks, and there are plenty of recent sales to compare against. Should sell within ~9 days at typical pricing.",
				"",
				"Want me to place the order once you're signed in?",
			].join("\n"),
		},
	],
};

const OFFERS_PAYLOAD = {
	offers: [
		{
			offerId: "ofr_jordan_4_bred",
			item: {
				itemId: "v1|336567147514|0",
				title: "Air Jordan 4 Bred Reimagined · Sz 10",
				url: "https://www.ebay.com/itm/336567147514",
				image: JORDAN_4_IMG,
				listPrice: { value: 24500, currency: "USD" },
				condition: "Pre-Owned",
			},
			buyerOffer: { value: 21000, currency: "USD" },
			createdAt: new Date(Date.now() - 14 * 3_600_000).toISOString(),
		},
		{
			offerId: "ofr_anova_pro",
			item: {
				itemId: "v1|227318659571|0",
				title: "Anova Precision Cooker Pro · Open Box",
				url: "https://www.ebay.com/itm/227318659571",
				image: "https://i.ebayimg.com/images/g/m~cAAeSwjSppwvms/s-l500.webp",
				listPrice: { value: 16500, currency: "USD" },
				condition: "Open Box",
			},
			buyerOffer: { value: 12000, currency: "USD" },
			createdAt: new Date(Date.now() - 36 * 3_600_000).toISOString(),
		},
	],
};

const BEST_OFFERS: MockScript = {
	prompt: "Any pending Best Offers I should accept?",
	events: [
		{ kind: "tool_start", name: "flipagent_list_offers", delayMs: 600 },
		{
			kind: "tool_end",
			delayMs: 1400,
			ui: {
				resourceUri: "ui://flipagent/offers",
				props: OFFERS_PAYLOAD,
			},
		},
		{
			kind: "done",
			delayMs: 500,
			reply: [
				"Two pending offers — listed above with how far each sits below your list price.",
				"",
				"Hit Accept / Counter / Decline directly, or click Evaluate on a row to pull market comps before deciding.",
			].join("\n"),
		},
	],
};

export const MOCK_SCRIPTS: ReadonlyArray<MockScript> = [
	LEGO_FLIP,
	CANON_FLIP,
	BEST_OFFERS,
];

/** Find the script whose prompt the user input matches exactly (after
 *  trim). `null` when nothing matches — caller falls back to the
 *  sign-in CTA stub. */
export function findMockScript(input: string): MockScript | null {
	const trimmed = input.trim();
	return MOCK_SCRIPTS.find((s) => s.prompt === trimmed) ?? null;
}
