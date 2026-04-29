/**
 * Playground orchestration. Two pipelines:
 *
 *   runEvaluate({ itemId })
 *     detail → sold_search → match → market/summary → evaluate
 *
 *   runDiscover({ q | category_ids, ... })
 *     listings/search → sold_search (one shared pool) → match → discover
 *
 * Both stream per-step status to the caller via `onStep`. The UI
 * (PlaygroundEvaluate / PlaygroundDiscover) reads each Step into a
 * collapsible Trace component — users see the chain unfold in real
 * time and can copy any sub-call as cURL.
 *
 * The chain is deliberately client-side: trace transparency is part of
 * the value prop ("see exactly which comparables were used to reach this
 * evaluation"). Wrapping it in a single server endpoint would either
 * collapse the trace into one opaque blob or duplicate every step's
 * response into the wrapper response — both bad.
 */

import { playgroundApi, type ApiPlan, type ApiResponse } from "./api";
import { MOCK_DISCOVER, mockEvaluateFixture } from "./mockData";
import type {
	BrowseSearchResponse,
	ItemDetail,
	ItemSummary,
	MatchResponse,
	RankedDeal,
	Step,
	StepStatus,
	MarketSummary,
	Evaluation,
} from "./types";

export type StepUpdate = (key: string, patch: Partial<Step>) => void;

/* ----------------------------- helpers ----------------------------- */

/**
 * Normalise free-form user input ("123456789012", "v1|…|0", or any
 * `ebay.com/itm/<id>` URL variant) into the v1 itemId the API expects.
 * Returns null when nothing parses — the caller surfaces a validation
 * error before kicking off the chain.
 */
export function parseItemId(input: string): string | null {
	const t = input.trim();
	if (!t) return null;
	if (/^v1\|\d+\|0$/.test(t)) return t;
	if (/^\d{9,}$/.test(t)) return `v1|${t}|0`;
	const m = t.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) ?? t.match(/[?&]item=(\d{9,})/);
	return m && m[1] ? `v1|${m[1]}|0` : null;
}

function asTitleQuery(detail: ItemDetail): string {
	// Trim eBay's clutter so sold_search returns dense matches: drop
	// punctuation but keep numbers (model refs) and case (eBay search is
	// case-insensitive but extra whitespace hurts).
	return detail.title.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}

function summariseError<T>(res: ApiResponse<T>): string {
	if (res.status === 0) {
		const b = res.body as { message?: string } | undefined;
		return `Couldn't reach the API — ${b?.message || "network error"}`;
	}
	const b = res.body as { error?: string; message?: string };
	if (b && typeof b === "object") return [b.error, b.message].filter(Boolean).join(": ") || `HTTP ${res.status}`;
	return `HTTP ${res.status}`;
}

/**
 * Invoke an API call as one named step: emit running → resolve to ok/error
 * with the response body and timing. Returns the parsed body on success
 * or null on failure (caller short-circuits).
 */
async function runStep<T>(
	step: { key: string; label: string },
	onStep: StepUpdate,
	prepare: () => ApiPlan<T>,
): Promise<T | null> {
	const plan = prepare();
	// Surface the call (and request body) the moment the step starts so the
	// trace shows what was sent before the response lands.
	onStep(step.key, {
		status: "running",
		label: step.label,
		call: plan.call,
		requestBody: plan.requestBody,
	});
	const res = await plan.exec();
	if (!res.ok) {
		onStep(step.key, {
			status: "error",
			call: res.call,
			requestBody: res.requestBody,
			httpStatus: res.status,
			result: res.body,
			error: summariseError(res),
			durationMs: res.durationMs,
		});
		return null;
	}
	onStep(step.key, {
		status: "ok",
		call: res.call,
		requestBody: res.requestBody,
		httpStatus: res.status,
		result: res.body,
		durationMs: res.durationMs,
	});
	return res.body as T;
}

/* ------------------------- evaluate pipeline ------------------------- */

export const EVALUATE_STEPS = [
	{ key: "detail", label: "Look up the listing" },
	{ key: "sold", label: "Find recent sales" },
	{ key: "active", label: "Find active competition" },
	{ key: "match", label: "Match same product" },
	{ key: "marketSummary", label: "Calculate market price" },
	{ key: "evaluate", label: "Decide if it's a good deal" },
] as const;

export interface EvaluateOutcome {
	detail: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	buckets: MatchResponse;
	marketSummary: MarketSummary;
	evaluation: Evaluation;
}

export interface EvaluateInputs {
	itemId: string;
	/** How far back to look for past sales (days). Default 90. */
	lookbackDays?: number;
	/** Cap on past-sale count. Default 50, max 200. */
	sampleLimit?: number;
	/** Floor for the BUY evaluation — only call it BUY if net ≥ this many cents. */
	minNetCents?: number;
	/** Outbound shipping cost in cents. Defaults server-side to $10 when omitted. */
	outboundShippingCents?: number;
	/**
	 * Hard ceiling on expected days-to-sell — feeds the user's "Sell within
	 * X days" filter into the recommended-exit grid search.
	 */
	maxDaysToSell?: number;
	/** When false, skip image inspection in match step (cheaper / faster). Default true. */
	useImages?: boolean;
}

/**
 * Build eBay's Marketplace Insights `lastSoldDate:[since..]` filter so
 * sold_search only returns sales within the lookback window.
 */
function lookbackFilter(days: number | undefined): string | undefined {
	if (!days || days <= 0) return undefined;
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	return `lastSoldDate:[${since}..]`;
}

/**
 * eBay condition tiers, grouped by what the resale market treats as
 * interchangeable. Pre-filtering the comparable pool by tier keeps Refurbished
 * / Parts-Only listings out of the LLM matcher (cheaper + no cross-tier
 * false positives).
 *
 * Sources of truth: eBay's localized `condition` strings on each listing
 * (used by the scrape path) and the canonical conditionId enum (used by
 * the Marketplace Insights REST `conditionIds:{...}` filter).
 */
const COND_FAMILIES = {
	NEW: { ids: ["1000", "1500", "1750"], match: /^new\b|^brand new|with box|sealed/i },
	REFURB: { ids: ["2000", "2010", "2020", "2030", "2500"], match: /refurbish|like new/i },
	USED: { ids: ["3000", "4000", "5000", "6000"], match: /pre-?owned|^used\b|very good|good|acceptable|excellent/i },
	PARTS: { ids: ["7000"], match: /parts|not working|for parts/i },
} as const;

type CondFamily = keyof typeof COND_FAMILIES;

function familyForConditionId(id: string | undefined): CondFamily | undefined {
	if (!id) return undefined;
	for (const [k, v] of Object.entries(COND_FAMILIES) as [CondFamily, (typeof COND_FAMILIES)[CondFamily]][]) {
		if ((v.ids as readonly string[]).includes(id)) return k;
	}
	return undefined;
}

function familyForConditionString(s: string | undefined): CondFamily | undefined {
	if (!s) return undefined;
	// REFURB before NEW — "Like new" / "Excellent refurbished" can hit both.
	if (COND_FAMILIES.REFURB.match.test(s)) return "REFURB";
	if (COND_FAMILIES.PARTS.match.test(s)) return "PARTS";
	if (COND_FAMILIES.NEW.match.test(s)) return "NEW";
	if (COND_FAMILIES.USED.match.test(s)) return "USED";
	return undefined;
}

/** Filter expression for the API call (REST path honors it; scrape path ignores). */
function conditionFamilyFilter(id: string | undefined): string | undefined {
	const fam = familyForConditionId(id);
	if (!fam) return undefined;
	return `conditionIds:{${COND_FAMILIES[fam].ids.join("|")}}`;
}

/**
 * Backstop for the scrape path, which ignores the conditionIds filter.
 * Drops pool entries whose condition string falls outside the candidate's
 * tier. Items with unrecognised condition strings pass through (the
 * LLM matcher decides).
 */
function poolFilteredByCondition(pool: ItemSummary[], targetFamily: CondFamily | undefined): ItemSummary[] {
	if (!targetFamily) return pool;
	return pool.filter((p) => {
		const fam = familyForConditionString(p.condition);
		return fam === undefined || fam === targetFamily;
	});
}

/** Join non-empty filter expressions with eBay's `,` separator. */
function joinFilters(parts: ReadonlyArray<string | undefined>): string | undefined {
	const live = parts.filter((p): p is string => Boolean(p));
	return live.length > 0 ? live.join(",") : undefined;
}

export async function runEvaluate(
	inputs: EvaluateInputs,
	onStep: StepUpdate,
): Promise<EvaluateOutcome | null> {
	const detail = await runStep(EVALUATE_STEPS[0], onStep, () => playgroundApi.itemDetail(inputs.itemId));
	if (!detail) return null;

	const q = asTitleQuery(detail);
	const limit = Math.max(1, Math.min(200, inputs.sampleLimit ?? 50));
	const candidateFamily = familyForConditionId(detail.conditionId);
	const filter = joinFilters([
		lookbackFilter(inputs.lookbackDays),
		conditionFamilyFilter(detail.conditionId),
	]);
	const sold = await runStep(EVALUATE_STEPS[1], onStep, () => playgroundApi.soldSearch({ q, limit, filter }));
	if (!sold) return null;
	// REST path filters at eBay; scrape path ignores filter, so backstop in JS
	// using the localized condition string. Either way the LLM matcher only
	// sees same-tier comparables.
	const soldPool: ItemSummary[] = poolFilteredByCondition(sold.itemSales ?? sold.itemSummaries ?? [], candidateFamily);

	// Active listings — same query, raw count + price points for the
	// visual. We don't gate the rest of the pipeline on this: when
	// listings/search fails (rate-limit, scraper outage, eBay block), we
	// mark the step "skipped" and continue. The evaluation is still useful
	// without the competition view.
	const activeStep = EVALUATE_STEPS[2];
	let activePool: ItemSummary[] = [];
	{
		const activePlan = playgroundApi.listingsSearch({ q, limit: 50 });
		onStep(activeStep.key, {
			status: "running",
			label: activeStep.label,
			call: activePlan.call,
			requestBody: activePlan.requestBody,
		});
		const res = await activePlan.exec();
		if (res.ok) {
			activePool = (res.body as BrowseSearchResponse).itemSummaries ?? [];
			onStep(activeStep.key, {
				status: "ok",
				call: res.call,
				requestBody: res.requestBody,
				httpStatus: res.status,
				result: res.body,
				durationMs: res.durationMs,
			});
		} else {
			onStep(activeStep.key, {
				status: "skipped",
				call: res.call,
				requestBody: res.requestBody,
				httpStatus: res.status,
				result: res.body,
				durationMs: res.durationMs,
				error: "Active competition unavailable — evaluation still computed.",
			});
		}
	}

	// Match against sold AND active in one call. Sold items feed market summary
	// market stats (what people paid); active items feed market summary ask-side
	// stats (what people are listing for). Without filtering active too,
	// the asks distribution is noisy with off-product listings. Dedupe
	// across pools — a listing can theoretically appear in both feeds.
	const soldIds = new Set(soldPool.map((i) => i.itemId));
	const combinedPool = [...soldPool, ...activePool.filter((a) => !soldIds.has(a.itemId))];
	const buckets = await runStep(EVALUATE_STEPS[3], onStep, () =>
		playgroundApi.match({
			candidate: detail,
			pool: combinedPool,
			options: { useImages: inputs.useImages ?? true },
		}),
	);
	if (!buckets) return null;

	// Split matched items back to their originating cohort. Sold-side
	// matches feed `comparables` (margin math, market median); active-side
	// matches feed `asks` (asking-price distribution).
	const matchedSold = buckets.match.filter((m) => soldIds.has(m.item.itemId)).map((m) => m.item);
	const matchedActive = buckets.match.filter((m) => !soldIds.has(m.item.itemId)).map((m) => m.item);
	const marketSummary = await runStep(EVALUATE_STEPS[4], onStep, () =>
		playgroundApi.researchSummary({ comparables: matchedSold, asks: matchedActive.length > 0 ? matchedActive : undefined }),
	);
	if (!marketSummary) return null;

	const evalOpts: {
		comparables: ItemSummary[];
		asks?: ItemSummary[];
		minNetCents?: number;
		outboundShippingCents?: number;
		maxDaysToSell?: number;
	} = { comparables: matchedSold };
	if (matchedActive.length > 0) evalOpts.asks = matchedActive;
	if (inputs.minNetCents != null && inputs.minNetCents > 0) evalOpts.minNetCents = inputs.minNetCents;
	if (inputs.outboundShippingCents != null) evalOpts.outboundShippingCents = inputs.outboundShippingCents;
	if (inputs.maxDaysToSell != null && inputs.maxDaysToSell > 0) evalOpts.maxDaysToSell = inputs.maxDaysToSell;
	const evaluation = await runStep(EVALUATE_STEPS[5], onStep, () =>
		playgroundApi.evaluate({ item: detail, opts: evalOpts }),
	);
	if (!evaluation) return null;

	return { detail, soldPool, activePool, buckets, marketSummary, evaluation };
}

/* ------------------------- discover pipeline ------------------------- */

export const DISCOVER_STEPS = [
	{ key: "search", label: "Search current listings" },
	{ key: "sold", label: "Find recent sales for comparison" },
	{ key: "discover", label: "Rank by best deals" },
] as const;

export interface DiscoverInputs {
	q?: string;
	categoryId?: string;
	minPriceCents?: number;
	maxPriceCents?: number;
	/** Canonical eBay condition ids (1000, 1500, 2010, …). OR'd in the filter expression. */
	conditionIds?: string[];
	/** ISO country code, or "EU" for the European Union region, or undefined for any. */
	shipsFrom?: string;
	sort?: string;
	limit?: number;
	// Decision-floor opts forwarded to per-deal evaluate() — same shape +
	// defaults as the Evaluate panel.
	minNetCents?: number;
	maxDaysToSell?: number;
	outboundShippingCents?: number;
}

export interface DiscoverOutcome {
	search: BrowseSearchResponse;
	soldPool: ItemSummary[];
	deals: RankedDeal[];
}

/**
 * Translate the form's high-level fields into eBay's filter expression.
 * Spec: https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
 *   - `conditionIds:{a|b|c}` — OR of canonical condition ids
 *   - `price:[lo..hi],priceCurrency:USD` — range filter, either bound optional
 *   - `itemLocationCountry:CC` — exact ISO country
 *   - `itemLocationRegion:{REGION}` — eBay region (e.g. EUROPEAN_UNION)
 */
function buildSearchFilter(inputs: DiscoverInputs): string | undefined {
	const parts: string[] = [];
	if (inputs.conditionIds && inputs.conditionIds.length > 0) {
		parts.push(`conditionIds:{${inputs.conditionIds.join("|")}}`);
	}
	if (inputs.minPriceCents != null || inputs.maxPriceCents != null) {
		const lo = inputs.minPriceCents != null ? (inputs.minPriceCents / 100).toFixed(2) : "";
		const hi = inputs.maxPriceCents != null ? (inputs.maxPriceCents / 100).toFixed(2) : "";
		parts.push(`price:[${lo}..${hi}],priceCurrency:USD`);
	}
	if (inputs.shipsFrom === "EU") parts.push("itemLocationRegion:{EUROPEAN_UNION}");
	else if (inputs.shipsFrom) parts.push(`itemLocationCountry:${inputs.shipsFrom}`);
	return parts.length > 0 ? parts.join(",") : undefined;
}

export async function runDiscover(inputs: DiscoverInputs, onStep: StepUpdate): Promise<DiscoverOutcome | null> {
	const limit = Math.min(inputs.limit ?? 20, 50);
	const search = await runStep(DISCOVER_STEPS[0], onStep, () =>
		playgroundApi.listingsSearch({
			q: inputs.q,
			category_ids: inputs.categoryId,
			filter: buildSearchFilter(inputs),
			sort: inputs.sort,
			limit,
		}),
	);
	if (!search) return null;

	const candidates = search.itemSummaries ?? [];
	if (candidates.length === 0) {
		onStep(DISCOVER_STEPS[1].key, { status: "skipped", label: DISCOVER_STEPS[1].label });
		onStep(DISCOVER_STEPS[2].key, { status: "skipped", label: DISCOVER_STEPS[2].label });
		return { search, soldPool: [], deals: [] };
	}

	// One shared comparable pool keyed off the user's query (or, when only a
	// category is supplied, the leading title of the first result — better
	// than nothing for narrow-category sweeps).
	const compQuery = inputs.q?.trim() || candidates[0]?.title?.split(/\s+/).slice(0, 6).join(" ") || "";
	const sold = await runStep(DISCOVER_STEPS[1], onStep, () =>
		playgroundApi.soldSearch({ q: compQuery, limit: 50 }),
	);
	if (!sold) return null;
	const soldPool: ItemSummary[] = sold.itemSales ?? sold.itemSummaries ?? [];

	const ranked = await runStep(DISCOVER_STEPS[2], onStep, () =>
		playgroundApi.discover({
			results: search,
			opts: {
				comparables: soldPool,
				minNetCents: inputs.minNetCents,
				maxDaysToSell: inputs.maxDaysToSell,
				outboundShippingCents: inputs.outboundShippingCents,
			},
		}),
	);
	if (!ranked) return null;

	return { search, soldPool, deals: ranked.deals };
}

/* ----------------------------- step state ----------------------------- */

export function initialSteps<T extends ReadonlyArray<{ key: string; label: string }>>(steps: T): Step[] {
	return steps.map((s) => ({ key: s.key, label: s.label, status: "pending" as StepStatus }));
}

/* ----------------------------- mock pipelines ----------------------------- */

/**
 * Logged-out playground (landing hero) replays the same step sequence
 * with canned data so the trace + result UI render unchanged. Step
 * timing is simulated so the trace animation still feels live.
 */

const MOCK_STEP_DELAY_MS = 320;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockStep<T>(
	step: { key: string; label: string },
	onStep: StepUpdate,
	call: { method: "GET" | "POST"; path: string },
	result: T,
	requestBody?: unknown,
): Promise<T> {
	onStep(step.key, { status: "running", label: step.label, call, requestBody });
	const start = performance.now();
	await delay(MOCK_STEP_DELAY_MS);
	const durationMs = Math.round(performance.now() - start);
	onStep(step.key, { status: "ok", call, requestBody, httpStatus: 200, result, durationMs });
	return result;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
	const u = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
	const s = u.toString();
	return s ? `?${s}` : "";
}

export async function runDiscoverMock(inputs: DiscoverInputs, onStep: StepUpdate): Promise<DiscoverOutcome> {
	const limit = Math.min(inputs.limit ?? 20, 50);
	const searchPath = `/v1/buy/browse/item_summary/search${buildQuery({
		q: inputs.q,
		category_ids: inputs.categoryId,
		filter: buildSearchFilter(inputs),
		sort: inputs.sort,
		limit,
	})}`;
	const search = await mockStep<BrowseSearchResponse>(
		DISCOVER_STEPS[0],
		onStep,
		{ method: "GET", path: searchPath },
		MOCK_DISCOVER.search,
	);

	const compQuery = inputs.q?.trim() || (search.itemSummaries?.[0]?.title?.split(/\s+/).slice(0, 6).join(" ") ?? "");
	const sold = await mockStep<BrowseSearchResponse>(
		DISCOVER_STEPS[1],
		onStep,
		{ method: "GET", path: `/v1/buy/marketplace_insights/item_sales/search${buildQuery({ q: compQuery, limit: 50 })}` },
		MOCK_DISCOVER.sold,
	);

	const ranked = await mockStep(
		DISCOVER_STEPS[2],
		onStep,
		{ method: "POST", path: "/v1/discover" },
		MOCK_DISCOVER.ranked,
	);

	return {
		search,
		soldPool: sold.itemSales ?? sold.itemSummaries ?? [],
		deals: ranked.deals,
	};
}

export async function runEvaluateMock(inputs: EvaluateInputs, onStep: StepUpdate): Promise<EvaluateOutcome> {
	const fixture = mockEvaluateFixture(inputs.itemId);

	const detail = await mockStep<ItemDetail>(
		EVALUATE_STEPS[0],
		onStep,
		{ method: "GET", path: `/v1/buy/browse/item/${encodeURIComponent(inputs.itemId)}` },
		fixture.detail,
	);

	const lookbackDays = inputs.lookbackDays ?? 90;
	const sampleLimit = Math.max(1, Math.min(200, inputs.sampleLimit ?? 50));
	const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
	const q = asTitleQuery(detail);
	const soldPath = `/v1/buy/marketplace_insights/item_sales/search${buildQuery({
		q,
		limit: sampleLimit,
		filter: `lastSoldDate:[${since}..]`,
	})}`;
	await mockStep<BrowseSearchResponse>(
		EVALUATE_STEPS[1],
		onStep,
		{ method: "GET", path: soldPath },
		{ itemSales: fixture.soldPool, total: fixture.soldPool.length },
	);

	await mockStep<BrowseSearchResponse>(
		EVALUATE_STEPS[2],
		onStep,
		{ method: "GET", path: `/v1/buy/browse/item_summary/search${buildQuery({ q, limit: 50 })}` },
		{ itemSummaries: fixture.activePool, total: fixture.activePool.length },
	);

	await mockStep<MatchResponse>(
		EVALUATE_STEPS[3],
		onStep,
		{ method: "POST", path: "/v1/match" },
		fixture.buckets,
	);

	await mockStep<MarketSummary>(
		EVALUATE_STEPS[4],
		onStep,
		{ method: "POST", path: "/v1/research/summary" },
		fixture.marketSummary,
	);

	await mockStep<Evaluation>(
		EVALUATE_STEPS[5],
		onStep,
		{ method: "POST", path: "/v1/evaluate" },
		fixture.evaluation,
	);

	return {
		detail,
		soldPool: fixture.soldPool,
		activePool: fixture.activePool,
		buckets: fixture.buckets,
		marketSummary: fixture.marketSummary,
		evaluation: fixture.evaluation,
	};
}
