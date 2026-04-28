/**
 * Playground orchestration. Two pipelines:
 *
 *   runEvaluate({ itemId })
 *     detail → sold_search → match → research/thesis → evaluate
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
 * the value prop ("see exactly which comps were used to reach this
 * verdict"). Wrapping it in a single server endpoint would either
 * collapse the trace into one opaque blob or duplicate every step's
 * response into the wrapper response — both bad.
 */

import { playgroundApi, type ApiResponse } from "./api";
import type {
	BrowseSearchResponse,
	ItemDetail,
	ItemSummary,
	MatchResponse,
	RankedDeal,
	Step,
	StepStatus,
	ThesisResponse,
	Verdict,
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
	exec: () => Promise<ApiResponse<T>>,
): Promise<T | null> {
	onStep(step.key, { status: "running", label: step.label });
	const res = await exec();
	if (!res.ok) {
		onStep(step.key, {
			status: "error",
			call: res.call,
			result: res.body,
			error: summariseError(res),
			durationMs: res.durationMs,
		});
		return null;
	}
	onStep(step.key, {
		status: "ok",
		call: res.call,
		result: res.body,
		durationMs: res.durationMs,
	});
	return res.body as T;
}

/* ------------------------- evaluate pipeline ------------------------- */

export const EVALUATE_STEPS = [
	{ key: "detail", label: "Look up the listing" },
	{ key: "sold", label: "Find recent sales" },
	{ key: "match", label: "Match same product" },
	{ key: "thesis", label: "Calculate market price" },
	{ key: "evaluate", label: "Decide if it's a good deal" },
] as const;

export interface EvaluateOutcome {
	detail: ItemDetail;
	soldPool: ItemSummary[];
	buckets: MatchResponse;
	thesis: ThesisResponse;
	verdict: Verdict;
}

export async function runEvaluate(itemId: string, onStep: StepUpdate): Promise<EvaluateOutcome | null> {
	const detail = await runStep(EVALUATE_STEPS[0], onStep, () => playgroundApi.itemDetail(itemId));
	if (!detail) return null;

	const q = asTitleQuery(detail);
	const sold = await runStep(EVALUATE_STEPS[1], onStep, () => playgroundApi.soldSearch({ q, limit: 50 }));
	if (!sold) return null;
	const soldPool: ItemSummary[] = sold.itemSales ?? sold.itemSummaries ?? [];

	const buckets = await runStep(EVALUATE_STEPS[2], onStep, () =>
		playgroundApi.match({ candidate: detail, pool: soldPool }),
	);
	if (!buckets) return null;

	const matchedComps = buckets.match.map((m) => m.item);
	const thesis = await runStep(EVALUATE_STEPS[3], onStep, () =>
		playgroundApi.research({ comps: matchedComps }),
	);
	if (!thesis) return null;

	const verdict = await runStep(EVALUATE_STEPS[4], onStep, () =>
		playgroundApi.evaluate({ item: detail, opts: { comps: matchedComps } }),
	);
	if (!verdict) return null;

	return { detail, soldPool, buckets, thesis, verdict };
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

	// One shared comp pool keyed off the user's query (or, when only a
	// category is supplied, the leading title of the first result — better
	// than nothing for narrow-category sweeps).
	const compQuery = inputs.q?.trim() || candidates[0]?.title?.split(/\s+/).slice(0, 6).join(" ") || "";
	const sold = await runStep(DISCOVER_STEPS[1], onStep, () =>
		playgroundApi.soldSearch({ q: compQuery, limit: 50 }),
	);
	if (!sold) return null;
	const soldPool: ItemSummary[] = sold.itemSales ?? sold.itemSummaries ?? [];

	const ranked = await runStep(DISCOVER_STEPS[2], onStep, () =>
		playgroundApi.discover({ results: search, opts: { comps: soldPool } }),
	);
	if (!ranked) return null;

	return { search, soldPool, deals: ranked.deals };
}

/* ----------------------------- step state ----------------------------- */

export function initialSteps<T extends ReadonlyArray<{ key: string; label: string }>>(steps: T): Step[] {
	return steps.map((s) => ({ key: s.key, label: s.label, status: "pending" as StepStatus }));
}
