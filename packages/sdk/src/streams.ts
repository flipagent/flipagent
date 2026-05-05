/**
 * Live consumer for `/v1/evaluate/jobs/{id}/stream`. Single source of
 * truth for the SSE wire format — all UI surfaces (playground,
 * extension, embed iframe panel) consume the same async iterator
 * instead of re-implementing SSE parsing + polling fallback +
 * abort handling each time.
 *
 * Auth-agnostic: takes a `fetcher` (any function that returns a
 * Response). Bearer-token consumers (the SDK client itself, the Chrome
 * extension) bring a fetch wrapper that adds `Authorization: Bearer …`;
 * cookie-session consumers (the dashboard playground / embed) bring
 * a fetch wrapper with `credentials: "include"`. Either way, this
 * function only cares about the response stream.
 *
 * Yields a typed union:
 *   - `{ kind: "step", step }`      pipeline step lifecycle update
 *                                    (started/succeeded/failed merged
 *                                    into a single row with `status`)
 *   - `{ kind: "partial", patch }`  state hydration delta
 *   - `{ kind: "done", result }`    terminal — final EvaluateResponse
 *   - `{ kind: "error", … }`        terminal — typed pipeline error
 *   - `{ kind: "cancelled" }`       terminal — user cancelled
 *
 * `partial` events carry a typed `Partial<EvaluatePartial>` directly
 * — no client-side projection. The server is the single point that
 * decides what state has advanced and which fields the UI gets.
 */

import type { EvaluatePartial, EvaluateResponse } from "@flipagent/types";

/**
 * Polling cadence for the fallback path. SSE is the primary transport;
 * we only fall back when the response isn't `text/event-stream` (a
 * proxy stripped streaming, or a non-browser fetch impl that doesn't
 * surface a streaming body).
 */
const POLL_FALLBACK_MS = 1500;

/**
 * Hard ceiling on a single stream's duration. Pipelines almost never
 * exceed 4 minutes; this is a defensive backstop so a stuck stream
 * doesn't keep the consumer pinned forever.
 */
const STREAM_TIMEOUT_MS = 5 * 60_000;

/**
 * One pipeline step's current state — the SDK collapses the wire's
 * started → succeeded | failed sequence into this single row, with
 * `status` carrying which phase we're in. Trace UIs render one row
 * per `key`; `parent` lets sibling steps stack under a shared header
 * (e.g. `search.sold` + `search.active` under `search`).
 */
export interface EvaluateStep {
	key: string;
	status: "running" | "ok" | "error";
	label?: string;
	parent?: string;
	result?: unknown;
	durationMs?: number;
	error?: string;
	httpStatus?: number;
	errorBody?: unknown;
}

/** Typed terminal-error payload. Mirrors the route's `event: error`. */
export interface EvaluateStreamError {
	code: string | null;
	message: string;
	details?: unknown;
}

export type EvaluateStreamEvent =
	| { kind: "step"; step: EvaluateStep }
	| { kind: "partial"; patch: Partial<EvaluatePartial> }
	| { kind: "done"; result: EvaluateResponse }
	| { kind: "error"; error: EvaluateStreamError }
	| { kind: "cancelled" };

/**
 * Minimal fetch contract — any function that resolves a `Response`
 * given a path + init. Implementations attach auth (bearer header for
 * SDK / extension, cookie credentials for dashboard) and base URL.
 * Path is what comes after the base, e.g. `/v1/evaluate/jobs/{id}/stream`.
 */
export type StreamFetcher = (path: string, init?: RequestInit) => Promise<Response>;

export interface EvaluateStreamOptions {
	jobId: string;
	fetcher: StreamFetcher;
	signal?: AbortSignal;
	/**
	 * Overrides the per-stream watchdog. Default 5 minutes — long enough
	 * to cover any plausible run, short enough to release a stuck
	 * connection.
	 */
	timeoutMs?: number;
}

/**
 * Subscribe to a job's SSE stream. Yields events in arrival order,
 * terminating on `done` / `error` / `cancelled` / abort / timeout.
 *
 * On stream open the API server replays accumulated trace + partial
 * events from the row's `trace` column, so a late subscriber sees the
 * full history before the live tail. Reconnect-safe: re-subscribing
 * with the same jobId yields the full sequence again.
 */
export async function* streamEvaluateJob(opts: EvaluateStreamOptions): AsyncGenerator<EvaluateStreamEvent, void, void> {
	const { jobId, fetcher, signal: callerSignal } = opts;
	const path = `/v1/evaluate/jobs/${encodeURIComponent(jobId)}/stream`;

	const inner = new AbortController();
	const onAbort = () => inner.abort();
	if (callerSignal) {
		if (callerSignal.aborted) inner.abort();
		else callerSignal.addEventListener("abort", onAbort, { once: true });
	}
	const timer = setTimeout(() => inner.abort(), opts.timeoutMs ?? STREAM_TIMEOUT_MS);

	try {
		const res = await fetcher(path, {
			headers: { Accept: "text/event-stream" },
			signal: inner.signal,
		});

		if (!res.ok || !res.body || !isEventStream(res)) {
			// Polling fallback: server didn't return a streaming response
			// (proxy stripped it, or test stub returns plain JSON). Drive
			// the same yields off `GET /jobs/{id}` snapshots until terminal.
			yield* pollEvaluateJob(jobId, fetcher, inner.signal);
			return;
		}

		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		const steps = new StepTracker();
		let buffer = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			const blocks = buffer.split("\n\n");
			buffer = blocks.pop() ?? "";
			for (const block of blocks) {
				const parsed = parseSseBlock(block);
				if (!parsed) continue;
				yield* dispatchEvent(parsed, steps);
				if (isTerminalEvent(parsed.event)) return;
			}
		}
		// Stream closed without a terminal event — treat as failure so
		// callers don't hang waiting for a `done` that never came.
		yield {
			kind: "error",
			error: { code: "stream_truncated", message: "stream ended without a terminal event" },
		};
	} catch (err) {
		if ((err as Error).name === "AbortError") {
			yield { kind: "cancelled" };
			return;
		}
		yield {
			kind: "error",
			error: {
				code: "stream_failed",
				message: err instanceof Error ? err.message : String(err),
			},
		};
	} finally {
		clearTimeout(timer);
		if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
	}
}

/* --------------------------- internals --------------------------- */

function isEventStream(res: Response): boolean {
	const ct = res.headers.get("content-type") ?? "";
	return ct.toLowerCase().includes("text/event-stream");
}

function isTerminalEvent(name: string): boolean {
	return name === "done" || name === "error" || name === "cancelled";
}

interface ParsedBlock {
	event: string;
	data: string;
}

function parseSseBlock(block: string): ParsedBlock | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const raw of block.split("\n")) {
		if (raw.startsWith("event:")) event = raw.slice(6).trim();
		else if (raw.startsWith("data:")) dataLines.push(raw.slice(5).trimStart());
	}
	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

/**
 * Collapses started/succeeded/failed wire events into a single
 * `EvaluateStep` per key, progressing through statuses. Started events
 * seed `label` + `parent`; succeeded/failed events inherit them so the
 * wire doesn't repeat metadata on every emission.
 */
class StepTracker {
	private byKey = new Map<string, EvaluateStep>();
	get(key: string): EvaluateStep | undefined {
		return this.byKey.get(key);
	}
	merge(key: string, patch: Partial<EvaluateStep>): EvaluateStep {
		const prev = this.byKey.get(key);
		const next: EvaluateStep = { key, status: "running", ...prev, ...patch };
		this.byKey.set(key, next);
		return next;
	}
}

function* dispatchEvent(parsed: ParsedBlock, steps: StepTracker): Generator<EvaluateStreamEvent> {
	const data = safeJson(parsed.data);
	switch (parsed.event) {
		case "started": {
			if (!isObject(data)) return;
			const key = strField(data, "key");
			if (!key) return;
			const step = steps.merge(key, {
				status: "running",
				label: strField(data, "label"),
				parent: strField(data, "parent"),
			});
			yield { kind: "step", step };
			return;
		}
		case "succeeded": {
			if (!isObject(data)) return;
			const key = strField(data, "key");
			if (!key) return;
			const step = steps.merge(key, {
				status: "ok",
				result: data.result,
				durationMs: numField(data, "durationMs"),
			});
			yield { kind: "step", step };
			return;
		}
		case "failed": {
			if (!isObject(data)) return;
			const key = strField(data, "key");
			if (!key) return;
			const step = steps.merge(key, {
				status: "error",
				error: strField(data, "error"),
				httpStatus: numField(data, "httpStatus"),
				errorBody: data.errorBody,
				// Forward the upstream error body as `result` so the trace UI
				// renders it under Response — mirrors the JSON viewer it shows
				// on a successful row, so failures are observable in the
				// same shape.
				...(data.errorBody !== undefined ? { result: data.errorBody } : {}),
				durationMs: numField(data, "durationMs"),
			});
			yield { kind: "step", step };
			return;
		}
		case "partial": {
			// The server emits the patch as the bare event payload —
			// it's already a `Partial<EvaluatePartial>`, no wrapping
			// needed. Defensive cast: server is the schema authority.
			if (!isObject(data)) return;
			yield { kind: "partial", patch: data as Partial<EvaluatePartial> };
			return;
		}
		case "done": {
			if (data == null) return;
			yield { kind: "done", result: data as EvaluateResponse };
			return;
		}
		case "error": {
			const err = isObject(data) ? data : null;
			yield {
				kind: "error",
				error: {
					code: err ? (strField(err, "error") ?? null) : null,
					message: err ? (strField(err, "message") ?? "stream error") : "stream error",
					...(err && err.details !== undefined ? { details: err.details } : {}),
				},
			};
			return;
		}
		case "cancelled": {
			yield { kind: "cancelled" };
			return;
		}
		default:
			return;
	}
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

function strField(o: Record<string, unknown>, k: string): string | undefined {
	const v = o[k];
	return typeof v === "string" ? v : undefined;
}

function numField(o: Record<string, unknown>, k: string): number | undefined {
	const v = o[k];
	return typeof v === "number" ? v : undefined;
}

/* --------------------------- polling fallback --------------------------- */

interface JobSnapshot {
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	result: EvaluateResponse | null;
	partial: EvaluatePartial | null;
	errorCode: string | null;
	errorMessage: string | null;
	errorDetails?: unknown;
}

async function* pollEvaluateJob(
	jobId: string,
	fetcher: StreamFetcher,
	signal: AbortSignal,
): AsyncGenerator<EvaluateStreamEvent, void, void> {
	const path = `/v1/evaluate/jobs/${encodeURIComponent(jobId)}`;
	let lastPartialKeys = "";
	while (!signal.aborted) {
		const res = await fetcher(path, { signal }).catch(() => null);
		if (!res || !res.ok) {
			await sleep(POLL_FALLBACK_MS, signal);
			continue;
		}
		const body = (await res.json().catch(() => null)) as JobSnapshot | null;
		if (!body) {
			await sleep(POLL_FALLBACK_MS, signal);
			continue;
		}
		// Emit partial only when its content changed — polling otherwise
		// spams the consumer with identical patches between ticks.
		if (body.partial) {
			const sig = JSON.stringify(body.partial);
			if (sig !== lastPartialKeys) {
				lastPartialKeys = sig;
				yield { kind: "partial", patch: body.partial };
			}
		}
		if (body.status === "completed" && body.result) {
			yield { kind: "done", result: body.result };
			return;
		}
		if (body.status === "failed") {
			yield {
				kind: "error",
				error: {
					code: body.errorCode,
					message: body.errorMessage ?? "evaluate failed",
					...(body.errorDetails !== undefined ? { details: body.errorDetails } : {}),
				},
			};
			return;
		}
		if (body.status === "cancelled") {
			yield { kind: "cancelled" };
			return;
		}
		await sleep(POLL_FALLBACK_MS, signal);
	}
	yield { kind: "cancelled" };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}
