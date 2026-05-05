/**
 * Shared building blocks for the composite intelligence pipeline
 * (`runEvaluatePipeline`):
 *
 *   - `PipelineEvent` / `PipelineListener` — wire shape + listener
 *     type for everything the pipeline emits (step lifecycle plus
 *     state-hydration patches; the `kind` discriminator distinguishes)
 *   - `withStep`                            — emit start, time the
 *                                              body, emit success or
 *                                              failure
 *   - `emitPartial`                         — emit a typed state patch
 *   - `runMatchFilter`                      — LLM same-product filter
 *                                              (matchPool + partition
 *                                              + graceful fallback)
 *   - `EvaluateError`                       — typed throw for HTTP
 *                                              mapping
 */

import type { EvaluatePartial } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import type { ApiKey } from "../../db/schema.js";
import { detailFetcherFor } from "../items/detail.js";
import { type MatchProgress, MatchUnavailableError, matchPool } from "../match/index.js";
import { partitionMatched } from "../match/partition.js";
import type { MatchOptions } from "../match/types.js";

/* ------------------------------ step model ------------------------------ */

export interface StepRequestInfo {
	method: "GET" | "POST";
	path: string;
	body?: unknown;
}

/**
 * Everything the pipeline emits. Four kinds in one discriminated
 * union — three step lifecycle kinds (`started` / `succeeded` /
 * `failed`) for trace observability, plus `partial` for state
 * hydration (typed `Partial<EvaluatePartial>` patches the UI spreads
 * into outcome state). All four travel together on the same trace
 * JSON column + SSE replay path; the SSE event name comes straight
 * from `kind`.
 */
export type PipelineEvent =
	| { kind: "started"; key: string; label: string; parent?: string; request?: StepRequestInfo }
	| {
			kind: "succeeded";
			key: string;
			result: unknown;
			durationMs: number;
			source?: "rest" | "scrape" | "bridge";
	  }
	| {
			kind: "failed";
			key: string;
			error: string;
			/** Upstream HTTP status when the failure came from a typed service error (`ListingsError`, `EvaluateError`, …). Lets the trace UI render the same status pill as a successful row. */
			httpStatus?: number;
			/** Upstream response body when available — typically eBay's parsed error envelope. The trace UI renders it under Response so users see *what* failed, not just "eBay 429". */
			errorBody?: unknown;
			durationMs: number;
	  }
	| { kind: "partial"; patch: Partial<EvaluatePartial> };

/** Optional listener supplied by the route layer (no-op for collapsed JSON, SSE-write for the streaming route). */
export type PipelineListener = (event: PipelineEvent) => void;

/**
 * Convenience helper for pipeline code: emit a typed partial event
 * through the same listener that ferries step events. Kept colocated
 * with `withStep` so service code reads as `emitPartial(onStep, {…})`
 * — symmetric with how steps are emitted.
 */
export function emitPartial(listener: PipelineListener | undefined, patch: Partial<EvaluatePartial>): void {
	listener?.({ kind: "partial", patch });
}

/* ----------------------------- error mapping ----------------------------- */

export type EvaluateErrorCode =
	| "validation_failed"
	| "item_not_found"
	| "no_title"
	| "not_enough_sold"
	| "no_candidates"
	| "search_failed"
	| "variation_required";

/** Typed error the route layer maps to an HTTP response. */
export class EvaluateError extends Error {
	constructor(
		readonly code: EvaluateErrorCode,
		readonly status: 400 | 404 | 422 | 502,
		message: string,
		/**
		 * Optional structured payload surfaced alongside `code` + `message`.
		 * `variation_required` uses this to carry the enumerated variations
		 * (`{variations: EbayVariation[]}`) so the caller picks one and
		 * retries without a second round-trip. Routes serialise it under
		 * a top-level `details` field; SSE error events include it on the
		 * `error` payload.
		 */
		readonly details?: unknown,
	) {
		super(message);
		this.name = "EvaluateError";
	}
}

/* ----------------------------- step runner ----------------------------- */

interface WithStepOptions {
	key: string;
	label: string;
	parent?: string;
	request?: StepRequestInfo;
	onStep?: PipelineListener;
	/**
	 * Cooperative cancellation hook — the dispatcher passes a checker
	 * that throws `CancelledError` when the caller has flipped
	 * `cancel_requested` on the job. We invoke it at step boundaries
	 * (before `started` is emitted) so we never run a step that we know
	 * is going to be discarded. Mid-step IO (eBay scrape, LLM call) is
	 * uncancellable but step boundaries are tight enough for UX.
	 */
	cancelCheck?: () => Promise<void>;
}

/**
 * Run a step: emit `started`, time the body, emit `succeeded` (with
 * the body's return value) or `failed`, and re-throw on error so the
 * pipeline can stop. The success result becomes the step's `result`
 * field — keep it small enough to ship over SSE without ballooning
 * the wire (return shape `{ count, items }` is the typical pattern).
 *
 * The optional `source` returned by the body is forwarded onto the
 * `succeeded` event for transport-trace fidelity.
 */
export async function withStep<T>(
	opts: WithStepOptions,
	body: () => Promise<{ result: unknown; value: T; source?: "rest" | "scrape" | "bridge" }>,
): Promise<T> {
	if (opts.cancelCheck) await opts.cancelCheck();
	opts.onStep?.({
		kind: "started",
		key: opts.key,
		label: opts.label,
		parent: opts.parent,
		request: opts.request,
	});
	const start = performance.now();
	try {
		const out = await body();
		opts.onStep?.({
			kind: "succeeded",
			key: opts.key,
			result: out.result,
			durationMs: Math.round(performance.now() - start),
			source: out.source,
		});
		return out.value;
	} catch (err) {
		// Service errors (`ListingsError`, `EvaluateError`) carry an upstream
		// HTTP status + parsed response body. Forward both so the trace UI
		// renders the same status pill + JSON body it shows for successful
		// rows — failures are observable in the same shape, not a one-line
		// "eBay 429" with no detail.
		const e = err as { status?: unknown; body?: unknown };
		const httpStatus = typeof e.status === "number" ? e.status : undefined;
		const errorBody = e.body !== undefined ? e.body : undefined;
		opts.onStep?.({
			kind: "failed",
			key: opts.key,
			error: err instanceof Error ? err.message : String(err),
			...(httpStatus != null ? { httpStatus } : {}),
			...(errorBody !== undefined ? { errorBody } : {}),
			durationMs: Math.round(performance.now() - start),
		});
		// Tag so the route's outer catch knows this error already surfaced
		// as a step `failed` event — it would otherwise re-emit the same
		// payload as a pipeline-level SSE `error`, painting downstream
		// steps with the upstream error twice.
		if (typeof err === "object" && err !== null) {
			(err as { __stepEmitted?: true }).__stepEmitted = true;
		}
		throw err;
	}
}

/** True iff `withStep` already emitted this error as a step `failed` event. */
export function wasEmittedAsStep(err: unknown): boolean {
	return typeof err === "object" && err !== null && (err as { __stepEmitted?: true }).__stepEmitted === true;
}

/* ----------------------------- match filter ----------------------------- */

export interface MatchFilterResult {
	matchedSold: ItemSummary[];
	matchedActive: ItemSummary[];
	rejectedSold: ItemSummary[];
	rejectedActive: ItemSummary[];
	/** Per-itemId LLM reason string for every rejected listing. Keyed by
	 *  `itemId`. Empty when `llmRan === false` (no provider configured)
	 *  or when the matcher rejected nothing. */
	rejectionReasons: Record<string, string>;
	/** Per-itemId LLM-emitted rejection category (`wrong_product` |
	 *  `bundle_or_lot` | `off_condition` | `other`). Same key set as
	 *  `rejectionReasons`; consumed by the digest's
	 *  `filter.rejectionsByCategory` count map. */
	rejectionCategories: Record<string, string>;
	/** True iff the LLM actually ran. False on graceful fallback. */
	llmRan: boolean;
}

/**
 * Combined-pool LLM same-product filter. Dedupes sold ∪ active (sold
 * wins on collision), runs `matchPool` once, partitions the kept and
 * rejected items back to sold-side / active-side. Falls back to the
 * raw deduped pool when no LLM provider is configured — composite
 * endpoints stay up on self-host without a key, just with a looser
 * sold/active pool.
 *
 * Pure: no event emission, no timing. Wrap with `withStep("filter", ...)`
 * at the call site so the pipeline owns trace shape.
 */
export async function runMatchFilter(
	seed: ItemSummary,
	rawSold: ReadonlyArray<ItemSummary>,
	rawActive: ReadonlyArray<ItemSummary>,
	apiKey: ApiKey | undefined,
	// Default `useImages: false` — measured F1 the same (-0.03 at most) as
	// images=on for our top model (gemini-3.1-flash-lite-preview), but cuts
	// wall time 60% (3-4s vs 8-12s) and makes verify caching simpler. Caller
	// can override per-request when they specifically want visual matching
	// (e.g. categories where titles are sparse).
	matchOptions: MatchOptions = { useImages: false },
	sources: { seed?: string | null; sold?: string | null; active?: string | null } = {},
	onProgress?: (p: MatchProgress) => void,
): Promise<MatchFilterResult> {
	const soldIds = new Set(rawSold.map((s) => s.itemId));
	const dedupedPool: ItemSummary[] = [...rawSold, ...rawActive.filter((a) => !soldIds.has(a.itemId))];

	let matched: ItemSummary[] = dedupedPool;
	let rejected: ItemSummary[] = [];
	const rejectionReasons: Record<string, string> = {};
	const rejectionCategories: Record<string, string> = {};
	let llmRan = false;
	// DPLA gate. eBay's Developer Program License Agreement (June 2025
	// amendment) prohibits ingesting Restricted API responses into
	// generative AI models. We pass that obligation through: if any of
	// the inputs to the matcher were sourced from REST transport, we
	// silently fall back to the un-LLM-filtered pool. Operators who want
	// LLM matching should keep their listing/sold transports on `scrape`
	// (the default — see project_sourcing_transport_priority memory).
	const restSourced = [sources.seed, sources.sold, sources.active].filter((s) => s === "rest");
	if (restSourced.length > 0) {
		console.warn("[match] skipping LLM matcher — input sourced from eBay REST (DPLA AI-training prohibition).", {
			seed: sources.seed,
			sold: sources.sold,
			active: sources.active,
		});
		return {
			matchedSold: [...rawSold],
			matchedActive: [...rawActive],
			rejectedSold: [],
			rejectedActive: [],
			rejectionReasons: {},
			rejectionCategories: {},
			llmRan: false,
		};
	}
	try {
		// Caller-bound detail fetcher = the `DetailFetcher` port the
		// matcher expects. apiKey stays at this layer; the matcher
		// stays decoupled from auth + tier-quota concerns.
		const result = await matchPool(seed, dedupedPool, matchOptions, detailFetcherFor(apiKey), onProgress);
		matched = result.body.match.map((m) => m.item);
		rejected = result.body.reject.map((m) => m.item);
		// Capture per-listing reject reasons so the UI can surface them
		// inline under each rejected row instead of forcing the user to
		// drill into the trace / DB.
		for (const r of result.body.reject) {
			if (r.reason) rejectionReasons[r.item.itemId] = r.reason;
			if (r.category) rejectionCategories[r.item.itemId] = r.category;
		}
		llmRan = true;
	} catch (err) {
		if (!(err instanceof MatchUnavailableError)) throw err;
		// LLM not configured — keep the raw deduped pool as `matched`.
	}

	const kept = partitionMatched(matched, soldIds);
	const rej = partitionMatched(rejected, soldIds);
	return {
		matchedSold: kept.sold,
		matchedActive: kept.active,
		rejectedSold: rej.sold,
		rejectedActive: rej.active,
		rejectionReasons,
		rejectionCategories,
		llmRan,
	};
}

/* ------------------------------ utilities ------------------------------ */

/** Render a URL with deterministic query-string encoding for trace request paths. */
export function buildPath(base: string, params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== "") search.set(k, String(v));
	}
	const qs = search.toString();
	if (!qs) return base;
	const sep = base.includes("?") ? "&" : "?";
	return `${base}${sep}${qs}`;
}
