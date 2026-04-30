/**
 * Shared building blocks for the composite intelligence pipelines
 * (`runEvaluatePipeline`, `runDiscoverPipeline`). Each pipeline is its
 * own end-to-end function — what they share lives here:
 *
 *   - `StepEvent` / `StepRequestInfo`  — wire types for trace events
 *   - `EvaluateError`                  — typed throw for HTTP mapping
 *   - `withStep`                       — emit start, time the body,
 *                                         emit success or failure
 *   - `runMatchFilter`                 — LLM same-product filter
 *                                         (matchPool + partition +
 *                                         graceful fallback)
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import type { ApiKey } from "../../db/schema.js";
import { detailFetcherFor } from "../listings/detail.js";
import { MatchUnavailableError, matchPool } from "../match/index.js";
import { partitionMatched } from "../match/partition.js";
import type { MatchOptions } from "../match/types.js";

/* ------------------------------ step model ------------------------------ */

export interface StepRequestInfo {
	method: "GET" | "POST";
	path: string;
	body?: unknown;
}

/**
 * Step keys are pipeline-specific strings, so the wire union takes
 * `string` instead of a closed enum. Each pipeline defines its own
 * keyspace (e.g. evaluate uses "detail" / "search.sold" / "search.active"
 * / "filter" / "evaluate"; discover uses "search.active" / "search.sold"
 * / "filter" / "evaluate"). Keys are passed through to clients verbatim
 * so trace UIs can group, label, and order steps.
 */
export type StepEvent =
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
	/**
	 * Discover-only: emitted right after `cluster` step succeeds. Carries
	 * the cluster headers (canonical name + source + active count) so the
	 * UI can render section placeholders BEFORE per-cluster data arrives.
	 * No deals yet — those flow as `cluster.ready` events one-by-one.
	 */
	| {
			kind: "cluster.identified";
			clusters: ReadonlyArray<{
				idx: number;
				canonical: string;
				source: "epid" | "gtin" | "singleton";
				itemCount: number;
			}>;
	  }
	/**
	 * Discover-only: per-cluster completion. Emitted as soon as ONE
	 * variant cluster finishes its full Evaluate sub-flow, regardless of
	 * whether the other clusters are still running. The UI splices this
	 * into its partial outcome so each row fills in independently. `idx`
	 * matches the index in the preceding `cluster.identified` event.
	 *
	 * `cluster` carries the full Evaluate-shape payload (item, soldPool,
	 * activePool, market, evaluation, returns, meta) — the row IS one
	 * Evaluate result for this variant.
	 */
	| {
			kind: "cluster.ready";
			idx: number;
			cluster: import("@flipagent/types").DealCluster;
	  };

/** Optional per-step listener supplied by the route layer (no-op for collapsed JSON, SSE-write for the streaming route). */
export type StepListener = (event: StepEvent) => void;

/* ----------------------------- error mapping ----------------------------- */

export type EvaluateErrorCode =
	| "validation_failed"
	| "item_not_found"
	| "no_title"
	| "not_enough_sold"
	| "no_candidates"
	| "search_failed";

/** Typed error the route layer maps to an HTTP response. */
export class EvaluateError extends Error {
	constructor(
		readonly code: EvaluateErrorCode,
		readonly status: 400 | 404 | 422 | 502,
		message: string,
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
	onStep?: StepListener;
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
	matchOptions: MatchOptions = {},
): Promise<MatchFilterResult> {
	const soldIds = new Set(rawSold.map((s) => s.itemId));
	const dedupedPool: ItemSummary[] = [...rawSold, ...rawActive.filter((a) => !soldIds.has(a.itemId))];

	let matched: ItemSummary[] = dedupedPool;
	let rejected: ItemSummary[] = [];
	let llmRan = false;
	try {
		// Caller-bound detail fetcher = the `DetailFetcher` port the
		// matcher expects. apiKey stays at this layer; the matcher
		// stays decoupled from auth + tier-quota concerns.
		const result = await matchPool(seed, dedupedPool, matchOptions, detailFetcherFor(apiKey));
		matched = result.body.match.map((m) => m.item);
		rejected = result.body.reject.map((m) => m.item);
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
	return qs ? `${base}?${qs}` : base;
}
