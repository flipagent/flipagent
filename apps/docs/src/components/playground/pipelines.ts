/**
 * Playground orchestration for the Evaluate panel.
 *
 *   runEvaluate({ itemId })  → POST /v1/evaluate/jobs → SDK stream
 *                              → onStep / onPartial callbacks +
 *                                terminal `StreamOutcome`.
 *
 * The server runs the full pipeline (detail → sold + active →
 * same-product filter → score), emitting step events (trace UI) and
 * `partial` events (state hydration) as it goes. SSE parsing +
 * trace-row collapsing live in `@flipagent/sdk/streams`; this file
 * just adapts the SDK iterator to the playground's `Step` + outcome
 * shape.
 */

import { type EvaluateStreamEvent, streamEvaluateJob } from "@flipagent/sdk";
import { apiBase } from "../../lib/authClient";
import { mockEvaluateFixture } from "./mockData";
import type {
	BrowseSearchResponse,
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
 * Normalise free-form user input ("123456789012", "v1|…|0", "v1|…|<v>", or any
 * `ebay.com/itm/<id>` URL variant) into the v1 itemId the API expects.
 * Returns null when nothing parses — the caller surfaces a validation
 * error before kicking off the chain.
 *
 * Multi-SKU URLs carry the size/colour pick as `?var=<n>` (or as the
 * third segment of `v1|N|V`). We preserve it so the API skips its
 * `variation_required` guard and evaluates the SKU the user actually
 * picked instead of the parent group.
 */
export function parseItemId(input: string): string | null {
	const t = input.trim();
	if (!t) return null;
	const v1 = t.match(/^v1\|(\d+)\|(\d+)$/);
	if (v1) return `v1|${v1[1]}|${v1[2]}`;
	if (/^\d{9,}$/.test(t)) return `v1|${t}|0`;
	const m = t.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) ?? t.match(/[?&]item=(\d{9,})/);
	if (!m || !m[1]) return null;
	const legacy = m[1];
	// Pull `?var=<n>` off the URL form when present — same id eBay's API
	// accepts as `legacy_variation_id` and the same id our server's
	// `parseItemId` routes through to the variation-aware fetchers.
	const varMatch = t.match(/[?&]var=(\d+)/);
	const variationId = varMatch && varMatch[1] && varMatch[1] !== "0" ? varMatch[1] : "0";
	return `v1|${legacy}|${variationId}`;
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
	// shared parent stacks them under a vertical guide line.
	{ key: "search", label: "Search market" },
	{ key: "search.sold", label: "Find recent sales", parent: "search" },
	{ key: "search.active", label: "Find competing listings", parent: "search" },
	{ key: "filter", label: "Filter same product" },
	{ key: "evaluate", label: "Evaluate" },
];

export interface EvaluateOutcome {
	item: ItemDetail;
	/**
	 * Matched comp pool (sold side) — INCLUDES suspicious comps. The UI
	 * filters them out by default via `suspiciousIds` and re-includes
	 * them when the "show suspicious" toggle is on.
	 */
	soldPool: ItemSummary[];
	/** Matched comp pool (active side) — INCLUDES suspicious comps. Same convention as `soldPool`. */
	activePool: ItemSummary[];
	rejectedSoldPool: ItemSummary[];
	rejectedActivePool: ItemSummary[];
	rejectionReasons: Record<string, string>;
	/** Default-view market stats — computed from `soldPool` minus `suspiciousIds`. */
	market: EvaluateResponse["market"];
	/** Toggle-view market stats — computed from full `soldPool` (suspicious INcluded). */
	marketAll?: EvaluateResponse["market"];
	/** Default-view evaluation — scored against the cleaned pool. */
	evaluation: EvaluateResponse["evaluation"];
	/** Toggle-view evaluation — scored against the full pool. */
	evaluationAll?: EvaluateResponse["evaluation"];
	returns: EvaluateResponse["returns"];
	meta: EvaluateMeta;
	/**
	 * True while `market` is the raw-pool preliminary digest, before the
	 * LLM filter has run. Flips to false on the post-filter `digest`
	 * event. UI dims/marks the stat cards while this is true so users
	 * see numbers will sharpen.
	 */
	preliminary: boolean;
	/**
	 * Live triage progress during the LLM same-product filter step.
	 * Streamed as the matcher's chunks resolve (~every 3-5s). Cleared
	 * once the filter completes — outcome.filter / meta carries the
	 * final counts then.
	 */
	filterProgress?: { processed: number; total: number };
	/**
	 * Per-itemId map of comps the post-match risk filter flagged as
	 * likely-fake (Bayesian P_fraud > 0.4). UI uses this to
	 * (a) exclude flagged comps from the default-view median + histogram,
	 * (b) render a "show N suspicious" toggle, and
	 * (c) tint flagged rows + show the reason on hover when toggled on.
	 */
	suspiciousIds?: Record<string, { reason: string; pFraud: number }>;
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
}

/* ------------------------- compute-job helpers ------------------------- */

/**
 * Compute-job pipelines (today: evaluate) run through the same shape:
 * POST /jobs to create + start the worker, GET /jobs/{id}/stream
 * to watch trace events, POST /jobs/{id}/cancel to bail out. Tabs that
 * close mid-run leave the pipeline running server-side; reopening
 * resubscribes to /stream and replays accumulated trace from the row's
 * `trace` column before resuming live.
 */

export type ComputeJobKind = "evaluate";

export interface ComputeJobAck {
	id: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
}

/**
 * Typed error thrown by the playground's POST/stream helpers when the
 * server returns a non-2xx with a JSON envelope (`{ error, message, ... }`).
 * Carries the parsed body so the panel can surface specific affordances
 * (e.g. an Upgrade link for `credits_exceeded`) instead of dumping the
 * raw JSON into the banner.
 */
export class ApiJobError extends Error {
	readonly code: string;
	readonly status: number;
	readonly body: Record<string, unknown> | null;
	constructor(code: string, message: string, status: number, body: Record<string, unknown> | null) {
		super(message);
		this.name = "ApiJobError";
		this.code = code;
		this.status = status;
		this.body = body;
	}
}

async function readErrorEnvelope(res: Response, path: string): Promise<ApiJobError> {
	const text = await res.text().catch(() => "");
	let parsed: Record<string, unknown> | null = null;
	try {
		const v = JSON.parse(text);
		if (v && typeof v === "object") parsed = v as Record<string, unknown>;
	} catch {
		// non-JSON body — fall through to text-shaped fallback
	}
	const code = typeof parsed?.error === "string" ? (parsed.error as string) : `http_${res.status}`;
	const message =
		typeof parsed?.message === "string"
			? (parsed.message as string)
			: text
				? `${path} failed: HTTP ${res.status} — ${text.slice(0, 200)}`
				: `${path} failed: HTTP ${res.status}`;
	return new ApiJobError(code, message, res.status, parsed);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${apiBase}${path}`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw await readErrorEnvelope(res, `POST ${path}`);
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
	return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Cookie-authed fetcher for the SDK stream consumer. The dashboard
 * uses session cookies (no API key in the browser), so we wrap
 * `globalThis.fetch` with the right `credentials` mode + base URL
 * resolution. Bearer-token consumers (the SDK client, the Chrome
 * extension) bring their own fetcher.
 */
function dashboardStreamFetcher(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${apiBase}${path}`, {
		...init,
		credentials: "include",
	});
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
	| { kind: "failed"; message: string; code?: string; details?: Record<string, unknown> };

/**
 * One SKU on a multi-variation listing. The API ships these with the
 * `variation_required` error so the playground can render a picker
 * (size/colour + price per row) instead of dumping a generic banner.
 * Mirrors `EbayVariation` from `@flipagent/ebay-scraper`; redeclared
 * here because apps/docs intentionally doesn't pull that workspace.
 */
export interface EvaluateVariation {
	variationId: string;
	priceCents: number | null;
	currency: string;
	aspects: Array<{ name: string; value: string }>;
}

/**
 * Pull a typed `{legacyId, variations[]}` payload off an
 * `EvaluateError("variation_required")` envelope. Returns null when
 * the shape doesn't match — a generic banner falls through.
 */
export function readVariationDetails(
	details: Record<string, unknown> | undefined | null,
): { legacyId: string; variations: EvaluateVariation[] } | null {
	if (!details || typeof details !== "object") return null;
	const legacyId = typeof details.legacyId === "string" ? details.legacyId : null;
	const raw = Array.isArray(details.variations) ? (details.variations as unknown[]) : null;
	if (!legacyId || !raw) return null;
	const variations: EvaluateVariation[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		if (typeof e.variationId !== "string") continue;
		const aspects: Array<{ name: string; value: string }> = [];
		if (Array.isArray(e.aspects)) {
			for (const a of e.aspects) {
				if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
					aspects.push({
						name: (a as { name: string }).name,
						value: typeof (a as { value?: unknown }).value === "string" ? (a as { value: string }).value : "",
					});
				}
			}
		}
		variations.push({
			variationId: e.variationId,
			priceCents: typeof e.priceCents === "number" ? e.priceCents : null,
			currency: typeof e.currency === "string" ? e.currency : "USD",
			aspects,
		});
	}
	return variations.length > 0 ? { legacyId, variations } : null;
}

/**
 * Rewrite a server-side error code into a user-facing line for the
 * top banner. Codes the user might actually see often (worker_crashed
 * happens whenever the api restarts mid-run, common in dev) get a
 * friendly recovery hint; everything else falls back to the raw
 * server message.
 */
export function friendlyErrorMessage(message: string, code?: string, body?: Record<string, unknown> | null): string {
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
	if (code === "variation_required") {
		// The picker UI renders the variation chips below this line, so
		// keep the message itself a one-line guide instead of dumping the
		// server's "retry with a specific variationId" wording.
		return "This listing has multiple sizes or colours — pick one to evaluate.";
	}
	if (code === "credits_exceeded") {
		const used = typeof body?.creditsUsed === "number" ? (body.creditsUsed as number) : null;
		const limit = typeof body?.creditsLimit === "number" ? (body.creditsLimit as number) : null;
		const resetAt = typeof body?.resetAt === "string" ? (body.resetAt as string) : null;
		const usage = used != null && limit != null ? ` (${used} / ${limit} used)` : "";
		// Free tier is a one-time grant — no reset; paid tiers refill monthly.
		return resetAt
			? `Monthly credits exhausted${usage}. They refill on ${formatResetDate(resetAt)}, or upgrade for higher limits.`
			: `You've used your free credits${usage}. Upgrade to keep running this pipeline.`;
	}
	if (code === "burst_rate_limited") {
		const window = typeof body?.window === "string" ? (body.window as string) : "minute";
		return `Too many requests in the last ${window}. Wait a bit and try again — or upgrade for a higher burst limit.`;
	}
	// Stream truncated mid-run (network glitch, server restart, dropped
	// connection). The job often did complete server-side — clicking
	// the Recent row will hydrate from the saved result.
	if (message === "stream ended without a result") {
		return "Connection to the server was interrupted. The run may have finished — check the Recent strip below.";
	}
	return message || "Something went wrong.";
}

function formatResetDate(iso: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return iso;
	return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Build a banner-shape error from a thrown value: the friendly message
 * + an optional upgrade URL when the server returned one (today only
 * `credits_exceeded` carries `upgrade`). Keeps panels free of
 * ApiJobError-specific branching at every catch site.
 */
export function toBannerError(err: unknown): { message: string; upgradeUrl?: string } {
	if (err instanceof ApiJobError) {
		const upgradeUrl = typeof err.body?.upgrade === "string" ? (err.body.upgrade as string) : undefined;
		return { message: friendlyErrorMessage(err.message, err.code, err.body), ...(upgradeUrl ? { upgradeUrl } : {}) };
	}
	const message = err instanceof Error ? err.message : String(err);
	return { message: friendlyErrorMessage(message) };
}

export async function runEvaluate(
	inputs: EvaluateInputs,
	callbacks: RunEvaluateCallbacks,
	signal?: AbortSignal,
): Promise<StreamOutcome<EvaluateOutcome>> {
	const ack = await createEvaluateJob(inputs);
	callbacks.onJobCreated?.(ack.id);
	return consumeEvaluateStream(
		streamEvaluateJob({
			jobId: ack.id,
			fetcher: dashboardStreamFetcher,
			...(signal ? { signal } : {}),
		}),
		callbacks,
	);
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
	return consumeEvaluateStream(
		streamEvaluateJob({
			jobId,
			fetcher: dashboardStreamFetcher,
			...(signal ? { signal } : {}),
		}),
		callbacks,
	);
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
 * Consume the SDK's typed event stream and translate to the
 * playground's Step + outcome shape. Both `runEvaluate` (fresh job)
 * and `reopenEvaluate` (existing job) delegate here.
 *
 * The SDK has already done SSE parsing and the `started → succeeded`
 * trace-row collapse, so this function is now pure mapping: dispatch
 * trace rows to `onStep`, spread partial patches into outcome state,
 * surface terminal events as `StreamOutcome`. Single source of truth
 * for SSE wire format lives in `@flipagent/sdk`.
 */
async function consumeEvaluateStream(
	stream: AsyncGenerator<EvaluateStreamEvent, void, void>,
	cb: RunEvaluateCallbacks,
): Promise<StreamOutcome<EvaluateOutcome>> {
	const { onStep, onPartial } = cb;
	let final: EvaluateResponse | null = null;
	try {
		for await (const evt of stream) {
			switch (evt.kind) {
				case "step": {
					const step = evt.step;
					onStep(step.key, {
						status: step.status === "running" ? "running" : step.status === "ok" ? "ok" : "error",
						...(step.label ? { label: step.label } : {}),
						...(step.parent ? { parent: step.parent } : {}),
						...(step.result !== undefined ? { result: step.result } : {}),
						...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
						...(step.error ? { error: step.error } : {}),
						...(step.httpStatus !== undefined ? { httpStatus: step.httpStatus } : {}),
					});
					break;
				}
				case "partial": {
					if (onPartial) onPartial(evt.patch as Partial<EvaluateOutcome>);
					break;
				}
				case "done": {
					// Server's `EvaluateResponse` and the playground's local
					// mirror diverge on a few eBay-shape fields (e.g.
					// `authenticityGuarantee`); cast at the boundary since
					// the playground only reads a subset.
					final = evt.result as unknown as EvaluateResponse;
					break;
				}
				case "error": {
					// Pipeline-level error. `details` carries structured
					// payloads on typed errors (today: `variation_required`
					// ships `{legacyId, variations[]}` so the panel can
					// render a picker).
					const detailsObj =
						evt.error.details && typeof evt.error.details === "object"
							? (evt.error.details as Record<string, unknown>)
							: undefined;
					return {
						kind: "failed",
						message: evt.error.message,
						...(evt.error.code ? { code: evt.error.code } : {}),
						...(detailsObj ? { details: detailsObj } : {}),
					};
				}
				case "cancelled":
					return { kind: "cancelled" };
			}
		}
	} catch (err) {
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "failed", message };
	}

	if (!final) return { kind: "failed", message: "stream ended without a result" };
	const f = final as EvaluateResponse & {
		marketAll?: EvaluateResponse["market"];
		evaluationAll?: EvaluateResponse["evaluation"];
		suspiciousIds?: Record<string, { reason: string; pFraud: number }>;
	};
	return {
		kind: "success",
		value: {
			item: final.item,
			soldPool: final.soldPool ?? [],
			activePool: final.activePool ?? [],
			rejectedSoldPool: final.rejectedSoldPool ?? [],
			rejectedActivePool: final.rejectedActivePool ?? [],
			rejectionReasons: final.rejectionReasons ?? {},
			market: final.market,
			evaluation: final.evaluation,
			returns: final.returns ?? null,
			meta: final.meta,
			preliminary: false,
			...(f.marketAll ? { marketAll: f.marketAll } : {}),
			...(f.evaluationAll ? { evaluationAll: f.evaluationAll } : {}),
			...(f.suspiciousIds ? { suspiciousIds: f.suspiciousIds } : {}),
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
 * through every awaited delay in runEvaluateMock.
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
			{ method: "GET", path: `/v1/items/${encodeURIComponent(inputs.itemId)}` },
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
				path: `/v1/items/search?status=sold${buildQuery({ q, limit: soldLimit, filter: `lastSoldDate:[${since}..]` })}`,
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
			{ method: "GET", path: `/v1/items/search${buildQuery({ q, limit: 50 })}` },
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
			soldCount: fixture.soldPool.length,
			activeCount: fixture.activePool.length,
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
			rejectionReasons: {},
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
				rejectionReasons: {},
				market: fixture.marketSummary.market,
				evaluation: fixture.evaluation,
				returns: fixture.returns ?? null,
				meta,
				preliminary: false,
			},
		};
	} catch (err) {
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		throw err;
	}
}
