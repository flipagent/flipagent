/**
 * Playground orchestration. Two pipelines, both single composite calls:
 *
 *   runEvaluate({ itemId })   → POST /v1/evaluate → { item, evaluation, meta }
 *   runDiscover({ q, ... })   → POST /v1/discover → { deals, meta }
 *
 * The server runs the full pipeline (detail/search → sold + active →
 * same-product filter → score/rank) and returns a `meta` block
 * describing what was fetched. The playground synthesizes a 4-step
 * trace from `meta` so the UI still tells the story (lookup → search
 * → filter → decision) without the client re-implementing the chain.
 */

import { apiBase } from "../../lib/authClient";
import { playgroundApi, type ApiPlan, type ApiResponse } from "./api";
import { MOCK_DISCOVER, mockEvaluateFixture } from "./mockData";
import type {
	BrowseSearchResponse,
	DealCluster,
	DiscoverMeta,
	DiscoverResponse,
	EvaluateMeta,
	EvaluateResponse,
	ItemDetail,
	ItemSummary,
	Step,
	StepStatus,
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

/**
 * The four logical phases of /v1/evaluate. The `search` phase has two
 * parallel children (`search.sold`, `search.active`) — Trace renders
 * them side-by-side. Keep the order: parents come before their
 * children, so progressive UI insertion stays stable.
 */
export const EVALUATE_STEPS: ReadonlyArray<{ key: string; label: string; parent?: string }> = [
	{ key: "detail", label: "Look up listing" },
	// `search` is a synthetic parent that groups the parallel
	// `search.sold` + `search.active` pair. Without it, the two would
	// render as consecutive top-level rows that look sequential. The
	// shared parent stacks them under a vertical guide line — same
	// visual treatment discover uses for its per-cluster batches.
	{ key: "search", label: "Search market" },
	{ key: "search.sold", label: "Find recent sales", parent: "search" },
	{ key: "search.active", label: "Find competing listings", parent: "search" },
	{ key: "filter", label: "Filter same product" },
	{ key: "evaluate", label: "Evaluate" },
];

export interface EvaluateOutcome {
	item: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	rejectedSoldPool: ItemSummary[];
	rejectedActivePool: ItemSummary[];
	market: EvaluateResponse["market"];
	evaluation: EvaluateResponse["evaluation"];
	returns: EvaluateResponse["returns"];
	meta: EvaluateMeta;
}

export interface EvaluateInputs {
	itemId: string;
	/** Sold-search lookback window in days. Default 90. */
	lookbackDays?: number;
	/** Cap on sold-search results. Default 50. */
	soldLimit?: number;
	/** Floor for the BUY evaluation — only call it BUY if net ≥ this many cents. */
	minNetCents?: number;
	/** Outbound shipping cost in cents. Defaults server-side to $10 when omitted. */
	outboundShippingCents?: number;
	/**
	 * Hard ceiling on expected days-to-sell — feeds the user's "Sell within
	 * X days" filter into the recommended-exit grid search.
	 */
	maxDaysToSell?: number;
}

/**
 * Discriminated union over server-emitted step events. Step lifecycle
 * events (`started` / `succeeded` / `failed`) always carry `key`;
 * cluster events carry their own payload shape. Splitting these makes
 * `evt.key` narrow correctly inside `if (evt.kind === "started")` etc.
 * without us having to non-null assert at every call site.
 */
interface ServerStepLifecycleEvent {
	kind: "started" | "succeeded" | "failed";
	key: string;
	label?: string;
	parent?: string;
	request?: { method: "GET" | "POST"; path: string; body?: unknown };
	result?: unknown;
	error?: string;
	/** HTTP status forwarded from the upstream service error on a failed step. */
	httpStatus?: number;
	/** Parsed upstream response body forwarded on a failed step (e.g. eBay's error envelope). */
	errorBody?: unknown;
	durationMs?: number;
	source?: "rest" | "scrape" | "bridge";
}

interface ServerClusterIdentifiedEvent {
	kind: "cluster.identified";
	clusters: ReadonlyArray<{ idx: number; canonical: string; source: "epid" | "gtin" | "singleton"; itemCount: number }>;
}

interface ServerClusterReadyEvent {
	kind: "cluster.ready";
	idx: number;
	cluster: DealCluster;
}

type ServerStepEvent = ServerStepLifecycleEvent | ServerClusterIdentifiedEvent | ServerClusterReadyEvent;

/* ------------------------- compute-job helpers ------------------------- */

/**
 * Compute-job pipelines (evaluate / discover) all run through the same
 * shape: POST /jobs to create + start the worker, GET /jobs/{id}/stream
 * to watch trace events, POST /jobs/{id}/cancel to bail out. Tabs that
 * close mid-run leave the pipeline running server-side; reopening
 * resubscribes to /stream and replays accumulated trace from the row's
 * `trace` column before resuming live.
 */

export type ComputeJobKind = "evaluate" | "discover";

export interface ComputeJobAck {
	id: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${apiBase}${path}`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`POST ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
	}
	return (await res.json()) as T;
}

export async function createEvaluateJob(params: EvaluateInputs): Promise<ComputeJobAck> {
	return postJson<ComputeJobAck>("/v1/evaluate/jobs", {
		itemId: params.itemId,
		lookbackDays: params.lookbackDays,
		soldLimit: params.soldLimit,
		opts: pickEvaluateOpts(params),
	});
}

export async function cancelComputeJob(kind: ComputeJobKind, jobId: string): Promise<void> {
	await fetch(`${apiBase}/v1/${kind}/jobs/${encodeURIComponent(jobId)}/cancel`, {
		method: "POST",
		credentials: "include",
	}).catch(() => {
		// Best-effort — if the cancel call itself fails, the worker
		// finishes naturally and the stream still closes with a terminal
		// event.
	});
}

function pickEvaluateOpts(params: EvaluateInputs): Record<string, unknown> | undefined {
	const opts: Record<string, unknown> = {};
	if (params.minNetCents != null) opts.minNetCents = params.minNetCents;
	if (params.outboundShippingCents != null) opts.outboundShippingCents = params.outboundShippingCents;
	if (params.maxDaysToSell != null) opts.maxDaysToSell = params.maxDaysToSell;
	return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Subscribe to GET /v1/{evaluate,discover}/jobs/{id}/stream. Yields each
 * SSE event as `{ event, data }`. The server replays accumulated trace
 * events from the `trace` column first, then live-streams new events
 * until terminal (`done` / `cancelled` / `error`).
 *
 * Pass `signal` to drop the connection on unmount; the server keeps the
 * worker running regardless and a fresh subscriber can resume by
 * calling this again with the same `jobId`.
 */
async function* subscribeJobStream(
	kind: ComputeJobKind,
	jobId: string,
	signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: ServerStepEvent | EvaluateResponse | DiscoverResponse | { error?: string; message?: string } }> {
	const res = await fetch(`${apiBase}/v1/${kind}/jobs/${encodeURIComponent(jobId)}/stream`, {
		credentials: "include",
		headers: { Accept: "text/event-stream" },
		signal,
	});
	if (!res.ok || !res.body) {
		const text = await res.text().catch(() => "");
		throw new Error(`stream open failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		// SSE messages separated by blank line (\n\n).
		let sep = buffer.indexOf("\n\n");
		while (sep !== -1) {
			const block = buffer.slice(0, sep);
			buffer = buffer.slice(sep + 2);
			sep = buffer.indexOf("\n\n");
			let eventName = "message";
			const dataLines: string[] = [];
			for (const line of block.split("\n")) {
				if (line.startsWith("event:")) eventName = line.slice(6).trim();
				else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
			}
			if (dataLines.length === 0) continue;
			let data: unknown;
			try {
				data = JSON.parse(dataLines.join("\n"));
			} catch {
				continue;
			}
			yield { event: eventName, data: data as ServerStepEvent };
		}
	}
}

/**
 * Stream-based pipeline. The server is the single source of truth —
 * we translate its step events into the playground's Step shape and
 * stream partial outcome (item, soldPool, activePool) as each step
 * completes so the result panel hydrates incrementally instead of
 * staying blank until the final `done` arrives. Parallel children
 * (`search.sold`, `search.active`) come through as independent events
 * so the trace can show them progressing side-by-side.
 *
 * `onPartial` receives a patch each time a step's result lets us
 * surface something the UI can render: the item hero after detail,
 * the sold pool after search.sold, the active pool after search.active.
 * The consumer merges patches into a `Partial<EvaluateOutcome>` state.
 */
export interface RunEvaluateCallbacks {
	onStep: StepUpdate;
	onPartial?: (patch: Partial<EvaluateOutcome>) => void;
	/** Fired the moment the server creates the job row, before any stream events. Caller persists the id (localStorage) so a tab reload can resume. */
	onJobCreated?: (jobId: string) => void;
}

/**
 * Discriminated terminal status for a stream consumption. Lets callers
 * tell user-cancelled apart from upstream-failed apart from clean
 * success — important because a `null` collapse would mark a cancel as
 * "Failed" in the Recent strip.
 *
 * `failed.code` is the error_code stored on the compute_jobs row when
 * available (e.g. `worker_crashed`, `not_enough_sold`, `item_not_found`).
 * Lets the panel rewrite the raw `errorMessage` into something friendlier
 * for known codes instead of leaking server-side wording.
 */
export type StreamOutcome<T> =
	| { kind: "success"; value: T }
	| { kind: "cancelled" }
	| { kind: "failed"; message: string; code?: string };

/**
 * Rewrite a server-side error code into a user-facing line for the
 * top banner. Codes the user might actually see often (worker_crashed
 * happens whenever the api restarts mid-run, common in dev) get a
 * friendly recovery hint; everything else falls back to the raw
 * server message.
 */
export function friendlyErrorMessage(message: string, code?: string): string {
	if (code === "worker_crashed") {
		return "This run was interrupted by a server restart. Hit Run to try again.";
	}
	if (code === "item_not_found") {
		return "Couldn't find this listing on eBay — it may have been ended or removed.";
	}
	if (code === "not_enough_sold") {
		return "Not enough recent sales of this product to estimate a price. Try a more popular item.";
	}
	if (code === "no_candidates") {
		return "Search returned no listings. Broaden the query or relax the filters.";
	}
	if (code === "no_title") {
		return "Listing has no title — can't search comparable sales.";
	}
	// Stream truncated mid-run (network glitch, server restart, dropped
	// connection). The job often did complete server-side — clicking
	// the Recent row will hydrate from the saved result.
	if (message === "stream ended without a result") {
		return "Connection to the server was interrupted. The run may have finished — check the Recent strip below.";
	}
	return message || "Something went wrong.";
}

export async function runEvaluate(
	inputs: EvaluateInputs,
	callbacks: RunEvaluateCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<EvaluateOutcome>> {
	const ack = await createEvaluateJob(inputs);
	callbacks.onJobCreated?.(ack.id);
	return consumeEvaluateStream(subscribeJobStream("evaluate", ack.id, signal), callbacks);
}

/**
 * Reopen a saved evaluate job — used when the user clicks a Recent row.
 * The server's `/jobs/{id}/stream` route handles both flavours
 * uniformly:
 *
 *   - in_progress  : replays accumulated trace from the `trace` column,
 *                    then live-streams new events as the worker emits.
 *   - completed/   : replays the saved trace + the appropriate terminal
 *     failed/        event (`done` / `error` / `cancelled`), then
 *     cancelled      closes. Same code path on this side.
 *
 * Caller picks the right wrapping (rendering "running" vs "complete"
 * UI) based on the Recent row's `status` before reopening — the
 * stream just delivers the events.
 */
export async function reopenEvaluate(
	jobId: string,
	callbacks: RunEvaluateCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<EvaluateOutcome>> {
	return consumeEvaluateStream(subscribeJobStream("evaluate", jobId, signal), callbacks);
}

/**
 * Fetch the current state of a compute job (no trace) — used by the
 * boot sweep to reconcile Recent's `in_progress` rows with the server's
 * actual status. Returns null on 404 (expired or not ours).
 */
export async function fetchJobStatus(
	kind: ComputeJobKind,
	jobId: string,
): Promise<{ status: ComputeJobAck["status"]; errorCode: string | null; errorMessage: string | null } | null> {
	const res = await fetch(`${apiBase}/v1/${kind}/jobs/${encodeURIComponent(jobId)}`, {
		credentials: "include",
		headers: { Accept: "application/json" },
	});
	if (res.status === 404) return null;
	if (!res.ok) return null;
	const body = (await res.json()) as {
		status: ComputeJobAck["status"];
		errorCode?: string | null;
		errorMessage?: string | null;
	};
	return {
		status: body.status,
		errorCode: body.errorCode ?? null,
		errorMessage: body.errorMessage ?? null,
	};
}

/**
 * Consume an async stream of SSE-shaped events (live or replayed from a
 * persisted job) and translate to the playground's Step + outcome
 * shape. Both `runEvaluate` (fresh job) and `resumeEvaluate` /
 * `hydrateEvaluate` (existing job) delegate here so the dispatch logic
 * doesn't drift across paths.
 */
async function consumeEvaluateStream(
	stream: AsyncIterable<{ event: string; data: unknown }>,
	cb: RunEvaluateCallbacks,
): Promise<StreamOutcome<EvaluateOutcome>> {
	const { onStep, onPartial } = cb;
	let final: EvaluateResponse | null = null;
	try {
		for await (const { event, data } of stream) {
			if (event === "cancelled") {
				return { kind: "cancelled" };
			}
			if (event === "done") {
				final = data as EvaluateResponse;
				continue;
			}
			if (event === "error") {
				// Pipeline-level error (server reported the whole job failed,
				// not a specific step). Bubble up — the panel surfaces a
				// top-level banner + freezes any still-running step rows so
				// we don't leave Search market spinning while only Evaluate
				// shows an error.
				const e = data as { error?: string; message?: string };
				const message = e.message ?? e.error ?? "stream error";
				return { kind: "failed", message, ...(e.error ? { code: e.error } : {}) };
			}
			const evt = data as ServerStepEvent;
			if (evt.kind === "started") {
				onStep(evt.key, {
					status: "running",
					label: evt.label,
					parent: evt.parent,
					call: evt.request ? { method: evt.request.method, path: evt.request.path } : undefined,
					requestBody: evt.request?.body,
				});
			} else if (evt.kind === "succeeded") {
				onStep(evt.key, {
					status: "ok",
					result: evt.result,
					durationMs: evt.durationMs,
				});
				// Stream partial outcome as soon as each step's payload
				// lands so the UI hydrates incrementally — the item hero
				// after detail, the sold/active pools after each search
				// child, instead of all-or-nothing on `done`.
				if (onPartial) {
					if (evt.key === "detail") {
						const r = evt.result as { itemId?: string; title?: string; image?: unknown } | undefined;
						if (r && typeof r === "object" && "itemId" in r) {
							onPartial({ item: r as EvaluateOutcome["item"] });
						}
					} else if (evt.key === "search.sold") {
						const r = evt.result as { items?: EvaluateOutcome["soldPool"] } | undefined;
						if (r?.items) onPartial({ soldPool: r.items });
					} else if (evt.key === "search.active") {
						const r = evt.result as { items?: EvaluateOutcome["activePool"] } | undefined;
						if (r?.items) onPartial({ activePool: r.items });
					}
				}
			} else if (evt.kind === "failed") {
				onStep(evt.key, {
					status: "error",
					error: evt.error,
					httpStatus: evt.httpStatus,
					// Forward the upstream response body as `result` so the
					// trace UI's existing JSON-viewer renders it under
					// Response. Users see *what* failed (eBay's error
					// envelope, validation detail, …), not just the message.
					...(evt.errorBody !== undefined ? { result: evt.errorBody } : {}),
					durationMs: evt.durationMs,
				});
			}
		}
	} catch (err) {
		// AbortError = user-initiated cancel via the panel's AbortController.
		// Treat the same as a server-emitted `cancelled` event so the
		// caller doesn't lump it into "Failed".
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "failed", message };
	}

	if (!final) return { kind: "failed", message: "stream ended without a result" };
	return {
		kind: "success",
		value: {
			item: final.item,
			soldPool: final.soldPool ?? [],
			activePool: final.activePool ?? [],
			rejectedSoldPool: final.rejectedSoldPool ?? [],
			rejectedActivePool: final.rejectedActivePool ?? [],
			market: final.market,
			evaluation: final.evaluation,
			returns: final.returns ?? null,
			meta: final.meta,
		},
	};
}

/* ------------------------- discover pipeline ------------------------- */

export const DISCOVER_STEPS: ReadonlyArray<{ key: string; label: string; parent?: string }> = [
	{ key: "search.candidates", label: "Find candidate pool" },
	{ key: "cluster", label: "Group products" },
	{ key: "partition", label: "Split by variant" },
	// `detail`, `search.sold`, `filter`, `evaluate` are parents — children
	// (one per variant cluster) stream in dynamically. Server emits child
	// step keys as `<parent>.<idx>` with `parent` set to the matching
	// top-level key. Same per-variant primitives as `/v1/evaluate` (just
	// run K times in parallel instead of once) so the trace UI looks
	// identical for both pipelines.
	{ key: "detail", label: "Look up representatives" },
	{ key: "search.sold", label: "Find recent sales" },
	{ key: "filter", label: "Filter same product" },
	{ key: "evaluate", label: "Score variants" },
];

export interface DiscoverInputs {
	q: string;
	categoryId?: string;
	minPriceCents?: number;
	maxPriceCents?: number;
	/** Canonical eBay condition ids (1000, 1500, 2010, …). OR'd in the filter expression. */
	conditionIds?: string[];
	/** ISO country code, or "EU" for the European Union region, or undefined for any. */
	shipsFrom?: string;
	sort?: string;
	limit?: number;
	// Decision-floor opts forwarded to per-deal evaluate().
	minNetCents?: number;
	maxDaysToSell?: number;
	outboundShippingCents?: number;
}

export interface DiscoverOutcome {
	clusters: DealCluster[];
	meta: DiscoverMeta;
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

export async function createDiscoverJob(params: DiscoverInputs): Promise<ComputeJobAck> {
	return postJson<ComputeJobAck>("/v1/discover/jobs", {
		q: params.q,
		categoryId: params.categoryId,
		filter: buildSearchFilter(params) || undefined,
		limit: params.limit ? Math.min(params.limit, 50) : undefined,
		opts: pickDiscoverOpts(params),
	});
}

function pickDiscoverOpts(params: DiscoverInputs): Record<string, unknown> | undefined {
	const opts: Record<string, unknown> = {};
	if (params.minNetCents != null) opts.minNetCents = params.minNetCents;
	if (params.outboundShippingCents != null) opts.outboundShippingCents = params.outboundShippingCents;
	if (params.maxDaysToSell != null) opts.maxDaysToSell = params.maxDaysToSell;
	return Object.keys(opts).length > 0 ? opts : undefined;
}

export interface RunDiscoverCallbacks {
	onStep: StepUpdate;
	onPartial?: (patch: Partial<DiscoverOutcome>) => void;
	onJobCreated?: (jobId: string) => void;
}

export async function runDiscover(
	inputs: DiscoverInputs,
	callbacks: RunDiscoverCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<DiscoverOutcome>> {
	const ack = await createDiscoverJob(inputs);
	callbacks.onJobCreated?.(ack.id);
	return consumeDiscoverStream(subscribeJobStream("discover", ack.id, signal), callbacks);
}

/**
 * Reopen a saved discover job — same uniform behaviour as
 * `reopenEvaluate`. The server's `/jobs/{id}/stream` route replays the
 * accumulated trace (incl. per-cluster `cluster.identified` /
 * `cluster.ready` events) and emits the appropriate terminal event,
 * regardless of whether the job is still running or already done.
 */
export async function reopenDiscover(
	jobId: string,
	callbacks: RunDiscoverCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<DiscoverOutcome>> {
	return consumeDiscoverStream(subscribeJobStream("discover", jobId, signal), callbacks);
}

async function consumeDiscoverStream(
	stream: AsyncIterable<{ event: string; data: unknown }>,
	cb: RunDiscoverCallbacks,
): Promise<StreamOutcome<DiscoverOutcome>> {
	const { onStep, onPartial } = cb;

	// Progressive outcome accumulator. Each `cluster.identified` seeds a
	// placeholder DealCluster (loading row); `cluster.ready` replaces it
	// with the full Evaluate-shape payload. UI sees rows fill in one by
	// one without waiting for the final `done`.
	const partialClusters = new Map<number, DealCluster>();
	const flushPartial = () => {
		if (!onPartial) return;
		const ordered = [...partialClusters.entries()].sort(([a], [b]) => a - b);
		const clusters = ordered.map(([, c]) => c);
		// Sort by representative's $/day so the partial UI shows ranking
		// even before all clusters land. Same sort the final `done` does.
		clusters.sort((a, b) => {
			const ya = a.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
			const yb = b.evaluation.recommendedExit?.dollarsPerDay ?? Number.NEGATIVE_INFINITY;
			return yb - ya;
		});
		onPartial({ clusters });
	};

	let final: DiscoverResponse | null = null;
	try {
		for await (const { event, data } of stream) {
			if (event === "cancelled") {
				return { kind: "cancelled" };
			}
			if (event === "done") {
				final = data as DiscoverResponse;
				continue;
			}
			if (event === "error") {
				// Pipeline-level error — bubble up; panel handles the
				// banner + freezing of running step rows.
				const e = data as { error?: string; message?: string };
				const message = e.message ?? e.error ?? "stream error";
				return { kind: "failed", message, ...(e.error ? { code: e.error } : {}) };
			}
			const evt = data as ServerStepEvent;
			if (evt.kind === "cluster.identified") {
				// K placeholder cluster rows — render skeletons so the user
				// sees structure before any cluster's data lands. Real
				// payload arrives via `cluster.ready` and replaces wholesale.
				if (evt.clusters && onPartial) {
					for (const c of evt.clusters) {
						if (!partialClusters.has(c.idx)) {
							partialClusters.set(c.idx, makePlaceholderCluster(c.canonical, c.source, c.itemCount));
						}
					}
					flushPartial();
				}
			} else if (evt.kind === "cluster.ready") {
				if (evt.idx != null && evt.cluster) {
					partialClusters.set(evt.idx, evt.cluster);
					flushPartial();
				}
			} else if (evt.kind === "started") {
				if (evt.key) {
					onStep(evt.key, {
						status: "running",
						label: evt.label,
						parent: evt.parent,
						call: evt.request ? { method: evt.request.method, path: evt.request.path } : undefined,
						requestBody: evt.request?.body,
					});
				}
			} else if (evt.kind === "succeeded") {
				if (evt.key) {
					onStep(evt.key, { status: "ok", result: evt.result, durationMs: evt.durationMs });
				}
			} else if (evt.kind === "failed") {
				if (evt.key) {
					onStep(evt.key, {
						status: "error",
						error: evt.error,
						httpStatus: evt.httpStatus,
						...(evt.errorBody !== undefined ? { result: evt.errorBody } : {}),
						durationMs: evt.durationMs,
					});
				}
			}
		}
	} catch (err) {
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "failed", message };
	}

	if (!final) return { kind: "failed", message: "stream ended without a result" };
	return {
		kind: "success",
		value: {
			clusters: final.clusters ?? [],
			meta: final.meta,
		},
	};
}

/**
 * Stand-in DealCluster for the `cluster.identified` placeholder row —
 * carries the canonical name + source + count so the UI can show
 * "loading: <SKU> (<N> listings)" but no scoring fields. UI checks
 * `meta.soldCount === 0 && evaluation.recommendedExit == null` (or the
 * `__placeholder` flag) to render the loading state. Replaced wholesale
 * by the real `cluster.ready` payload.
 */
function makePlaceholderCluster(
	canonical: string,
	source: DealCluster["source"],
	itemCount: number,
): DealCluster {
	return {
		canonical,
		source,
		count: itemCount,
		// Synthetic minimal ItemDetail — UI's hero skeleton reads only
		// title + image, so empty fields are safe.
		item: {
			itemId: `placeholder-${canonical}`,
			title: canonical,
			itemWebUrl: "",
		} as unknown as ItemDetail,
		soldPool: [],
		activePool: [],
		rejectedSoldPool: [],
		rejectedActivePool: [],
		market: {
			keyword: canonical,
			marketplace: "EBAY_US",
			windowDays: 0,
			meanCents: 0,
			stdDevCents: 0,
			medianCents: 0,
			p25Cents: 0,
			p75Cents: 0,
			nObservations: 0,
			salesPerDay: 0,
		},
		evaluation: {},
		returns: null,
		meta: {
			itemSource: "rest",
			soldCount: 0,
			soldSource: null,
			activeCount: 0,
			activeSource: null,
			soldKept: 0,
			soldRejected: 0,
			activeKept: 0,
			activeRejected: 0,
		},
	};
}

/* ----------------------------- step state ----------------------------- */

export function initialSteps<T extends ReadonlyArray<{ key: string; label: string; parent?: string }>>(steps: T): Step[] {
	return steps.map((s) => ({
		key: s.key,
		label: s.label,
		status: "pending" as StepStatus,
		...(s.parent ? { parent: s.parent } : {}),
	}));
}

/* ----------------------------- mock pipelines ----------------------------- */

/**
 * Logged-out playground (landing hero) replays the same step sequence
 * with canned data so the trace + result UI render unchanged. Step
 * timing is simulated so the trace animation still feels live.
 */

const MOCK_STEP_DELAY_MS = 320;

/**
 * Sleep for `ms`, but reject early with an AbortError when `signal`
 * fires. Without this, the mock pipeline ignores the user's cancel
 * click and runs every step to completion — the Run button never flips
 * back, the trace keeps animating, and the cancel is a lie. Threaded
 * through every awaited delay in runDiscoverMock / runEvaluateMock.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(makeAbortError());
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(makeAbortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function makeAbortError(): Error {
	const err = new Error("aborted");
	err.name = "AbortError";
	return err;
}

async function mockStep<T>(
	step: { key: string; label: string },
	onStep: StepUpdate,
	call: { method: "GET" | "POST"; path: string },
	result: T,
	requestBody?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	onStep(step.key, { status: "running", label: step.label, call, requestBody });
	const start = performance.now();
	await delay(MOCK_STEP_DELAY_MS, signal);
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

/**
 * Mock the discover pipeline for the logged-out hero. Walks the same
 * trace shape as the real SSE pipeline (search → cluster → partition →
 * per-variant Evaluate sub-flow) and emits cluster.identified +
 * cluster.ready partials, against canned MOCK_DISCOVER fixtures.
 *
 * Honours `signal` — every awaited delay rejects with AbortError when
 * the user clicks Cancel, and the catch wrapper returns
 * `{ kind: "cancelled" }` so the panel's run() handler tears the trace
 * + button state down the same way the real path does.
 */
export async function runDiscoverMock(
	inputs: DiscoverInputs,
	callbacks: RunDiscoverCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<DiscoverOutcome>> {
	const { onStep, onPartial } = callbacks;
	const search = MOCK_DISCOVER.search;
	const findStep = (key: string): { key: string; label: string; parent?: string } => {
		const s = DISCOVER_STEPS.find((step) => step.key === key);
		if (!s) throw new Error(`unknown mock discover step ${key}`);
		return s;
	};
	const filter = buildSearchFilter(inputs);
	const limit = Math.min(inputs.limit ?? 20, 50);

	try {
		// 1. broad active search
		await mockStep<BrowseSearchResponse>(
			findStep("search.candidates"),
			onStep,
			{
				method: "GET",
				path: `/v1/buy/browse/item_summary/search${buildQuery({
					q: inputs.q,
					category_ids: inputs.categoryId,
					filter,
					limit,
				})}`,
			},
			search,
			undefined,
			signal,
		);

		// 2. deterministic bucket — synthetic
		const clusterStep = findStep("cluster");
		onStep(clusterStep.key, { status: "running", label: clusterStep.label });
		await delay(MOCK_STEP_DELAY_MS, signal);
		onStep(clusterStep.key, {
			status: "ok",
			result: { count: MOCK_DISCOVER.clusters.length },
			durationMs: MOCK_STEP_DELAY_MS,
		});

		// 3. variant partition — synthetic (mock fixtures are 1 variant per cluster)
		const partitionStep = findStep("partition");
		onStep(partitionStep.key, { status: "running", label: partitionStep.label });
		await delay(MOCK_STEP_DELAY_MS, signal);
		onStep(partitionStep.key, {
			status: "ok",
			result: { variantCount: MOCK_DISCOVER.clusters.length },
			durationMs: MOCK_STEP_DELAY_MS,
		});

		// emit cluster.identified placeholders so the UI fills in skeleton rows
		const placeholders = MOCK_DISCOVER.clusters.map((c, idx) => ({
			idx,
			canonical: c.canonical,
			source: c.source,
			itemCount: c.activePool.length,
		}));
		onPartial?.({
			clusters: placeholders.map((p) => ({
				canonical: p.canonical,
				source: p.source,
				count: p.itemCount,
				item: { itemId: `placeholder-${p.canonical}`, title: p.canonical, itemWebUrl: "" } as unknown as ItemDetail,
				soldPool: [],
				activePool: [],
				rejectedSoldPool: [],
				rejectedActivePool: [],
				market: {
					keyword: p.canonical,
					marketplace: "EBAY_US",
					windowDays: 0,
					meanCents: 0,
					stdDevCents: 0,
					medianCents: 0,
					p25Cents: 0,
					p75Cents: 0,
					nObservations: 0,
					salesPerDay: 0,
				},
				evaluation: {},
				returns: null,
				meta: {
					itemSource: "rest",
					soldCount: 0,
					soldSource: null,
					activeCount: 0,
					activeSource: null,
					soldKept: 0,
					soldRejected: 0,
					activeKept: 0,
					activeRejected: 0,
				},
			})),
		});

		// per-variant sub-flow steps (parent rows)
		for (const key of ["detail", "search.sold", "filter", "evaluate"] as const) {
			const s = findStep(key);
			onStep(s.key, { status: "running", label: s.label });
		}

		// 4. fill in clusters one by one — synthetic timing
		const ready: DealCluster[] = [];
		for (let idx = 0; idx < MOCK_DISCOVER.clusters.length; idx++) {
			await delay(MOCK_STEP_DELAY_MS, signal);
			ready.push(MOCK_DISCOVER.clusters[idx]!);
			onPartial?.({ clusters: [...ready] });
		}

		for (const key of ["detail", "search.sold", "filter", "evaluate"] as const) {
			const s = findStep(key);
			onStep(s.key, { status: "ok", result: { clusters: ready.length }, durationMs: MOCK_STEP_DELAY_MS });
		}

		const totalSold = ready.reduce((s, c) => s + c.soldPool.length, 0);
		const meta: DiscoverMeta = {
			activeCount: search.itemSummaries?.length ?? 0,
			activeSource: "scrape",
			soldCount: totalSold,
			soldSource: "scrape",
			clusterCount: ready.length,
		};

		return { kind: "success", value: { clusters: ready, meta } };
	} catch (err) {
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		throw err;
	}
}

/**
 * Mock evaluator for the logged-out hero. Mirrors the SSE pipeline's
 * step ordering — detail → search (sold + active in parallel) → filter
 * → evaluate — but with canned data and synthetic timing.
 */
export async function runEvaluateMock(
	inputs: EvaluateInputs,
	callbacks: RunEvaluateCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<EvaluateOutcome>> {
	const { onStep, onPartial } = callbacks;
	const fixture = mockEvaluateFixture(inputs.itemId);
	const lookbackDays = inputs.lookbackDays ?? 90;
	const soldLimit = Math.max(1, Math.min(200, inputs.soldLimit ?? 50));
	const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
	const q = fixture.detail.title;
	const findStep = (key: string): { key: string; label: string; parent?: string } => {
		const s = EVALUATE_STEPS.find((step) => step.key === key);
		if (!s) throw new Error(`unknown mock step ${key}`);
		return s;
	};

	try {
		// 1. detail
		await mockStep<ItemDetail>(
			findStep("detail"),
			onStep,
			{ method: "GET", path: `/v1/buy/browse/item/${encodeURIComponent(inputs.itemId)}` },
			fixture.detail,
			undefined,
			signal,
		);
		onPartial?.({ item: fixture.detail });

		// 2. search (parent + parallel children) — kick both children off, await both
		onStep("search", { status: "running", label: "Search market" });
		const soldChild = mockStep<BrowseSearchResponse>(
			findStep("search.sold"),
			onStep,
			{
				method: "GET",
				path: `/v1/buy/marketplace_insights/item_sales/search${buildQuery({ q, limit: soldLimit, filter: `lastSoldDate:[${since}..]` })}`,
			},
			{ itemSales: fixture.soldPool, total: fixture.soldPool.length },
			undefined,
			signal,
		).then((r) => {
			onPartial?.({ soldPool: fixture.soldPool });
			return r;
		});
		const activeChild = mockStep<BrowseSearchResponse>(
			findStep("search.active"),
			onStep,
			{ method: "GET", path: `/v1/buy/browse/item_summary/search${buildQuery({ q, limit: 50 })}` },
			{ itemSummaries: fixture.activePool, total: fixture.activePool.length },
			undefined,
			signal,
		).then((r) => {
			onPartial?.({ activePool: fixture.activePool });
			return r;
		});
		await Promise.all([soldChild, activeChild]);
		onStep("search", { status: "ok" });

		// 3. filter (LLM same-product) — synthetic counts.
		const filterStep = findStep("filter");
		onStep(filterStep.key, { status: "running", label: filterStep.label });
		await delay(MOCK_STEP_DELAY_MS, signal);
		onStep(filterStep.key, {
			status: "ok",
			result: {
				soldKept: fixture.soldPool.length,
				soldRejected: 0,
				activeKept: fixture.activePool.length,
				activeRejected: 0,
			},
			durationMs: MOCK_STEP_DELAY_MS,
		});

		// 4. evaluate
		const meta: EvaluateMeta = {
			itemSource: "scrape",
			soldCount: fixture.soldPool.length,
			soldSource: "scrape",
			activeCount: fixture.activePool.length,
			activeSource: "scrape",
			soldKept: fixture.soldPool.length,
			soldRejected: 0,
			activeKept: fixture.activePool.length,
			activeRejected: 0,
		};
		const composite: EvaluateResponse = {
			item: fixture.detail,
			soldPool: fixture.soldPool,
			activePool: fixture.activePool,
			rejectedSoldPool: [],
			rejectedActivePool: [],
			market: fixture.marketSummary.market,
			evaluation: fixture.evaluation,
			returns: fixture.returns ?? null,
			meta,
		};
		await mockStep<EvaluateResponse>(
			findStep("evaluate"),
			onStep,
			{ method: "POST", path: "/v1/evaluate" },
			composite,
			undefined,
			signal,
		);

		return {
			kind: "success",
			value: {
				item: fixture.detail,
				soldPool: fixture.soldPool,
				activePool: fixture.activePool,
				rejectedSoldPool: [],
				rejectedActivePool: [],
				market: fixture.marketSummary.market,
				evaluation: fixture.evaluation,
				returns: fixture.returns ?? null,
				meta,
			},
		};
	} catch (err) {
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		throw err;
	}
}
