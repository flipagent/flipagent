/**
 * Playground orchestration. Single composite call:
 *
 *   runEvaluate({ itemId })   → POST /v1/evaluate → { item, evaluation, meta }
 *
 * The server runs the full pipeline (detail → sold + active →
 * same-product filter → score) and returns a `meta` block describing
 * what was fetched. The playground synthesizes a 4-step trace from
 * `meta` so the UI still tells the story (lookup → search → filter →
 * decision) without the client re-implementing the chain.
 */

import { apiBase } from "../../lib/authClient";
import { playgroundApi, type ApiPlan, type ApiResponse } from "./api";
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
	// shared parent stacks them under a vertical guide line.
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
	rejectionReasons: Record<string, string>;
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
 * Server-emitted step lifecycle events (`started` / `succeeded` /
 * `failed`) always carry `key`. Splitting this from the wire envelope
 * makes `evt.key` narrow correctly inside `if (evt.kind === "started")`
 * etc. without us having to non-null assert at every call site.
 */
interface ServerStepEvent {
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
	if (params.maxDaysToSell != null) opts.maxDaysToSell = params.maxDaysToSell;
	return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Subscribe to GET /v1/evaluate/jobs/{id}/stream. Yields each SSE event
 * as `{ event, data }`. The server replays accumulated trace events
 * from the `trace` column first, then live-streams new events until
 * terminal (`done` / `cancelled` / `error`).
 *
 * Pass `signal` to drop the connection on unmount; the server keeps the
 * worker running regardless and a fresh subscriber can resume by
 * calling this again with the same `jobId`.
 */
async function* subscribeJobStream(
	kind: ComputeJobKind,
	jobId: string,
	signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: ServerStepEvent | EvaluateResponse | { error?: string; message?: string } }> {
	const res = await fetch(`${apiBase}/v1/${kind}/jobs/${encodeURIComponent(jobId)}/stream`, {
		credentials: "include",
		headers: { Accept: "text/event-stream" },
		signal,
	});
	if (!res.ok || !res.body) {
		throw await readErrorEnvelope(res, `GET /v1/${kind}/jobs/${jobId}/stream`);
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
				//
				// `details` carries structured payloads on typed errors
				// (today: `variation_required` ships `{legacyId, variations[]}`
				// so the panel can render a picker). Forward verbatim — the
				// UI layer reads it through `readVariationDetails`.
				const e = data as { error?: string; message?: string; details?: unknown };
				const message = e.message ?? e.error ?? "stream error";
				const detailsObj =
					e.details && typeof e.details === "object" ? (e.details as Record<string, unknown>) : undefined;
				return {
					kind: "failed",
					message,
					...(e.error ? { code: e.error } : {}),
					...(detailsObj ? { details: detailsObj } : {}),
				};
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
			rejectionReasons: final.rejectionReasons ?? {},
			market: final.market,
			evaluation: final.evaluation,
			returns: final.returns ?? null,
			meta: final.meta,
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
			},
		};
	} catch (err) {
		if ((err as Error).name === "AbortError") return { kind: "cancelled" };
		throw err;
	}
}
