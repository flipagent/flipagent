/**
 * Evaluate engine — pure HTTP plumbing shared by every on-page evaluate
 * surface (the floating chip on `/itm/{id}`, the per-row buttons on
 * `/sch/...`). Mirrors the playground's `runEvaluate` contract: the
 * caller passes an itemId + abort signal + step callback, we drive
 * `POST /v1/evaluate/jobs` followed by an SSE stream on
 * `/v1/evaluate/jobs/{id}/stream`, and resolve with the final
 * `EvaluateResponse` once the worker emits a `done` event.
 *
 * Stays free of UI concerns — no DOM, no styles. Surfaces compose
 * this engine with their own per-itemId state + render logic.
 */

import type { EvaluateResponse } from "@flipagent/types";
import type { ExtensionConfig } from "./shared.js";

const STREAM_TIMEOUT_MS = 5 * 60_000;
const POLL_FALLBACK_MS = 2_000;

/**
 * One trace step — mirrors apps/docs/.../playground/types.ts `Step`
 * shape so we can hand the steps array to the playground component
 * unchanged. The key/label/parent/result fields come straight from
 * the SSE event payload; status is derived (started → running, etc).
 */
export interface TraceStep {
	key: string;
	status: "running" | "ok" | "error";
	label?: string;
	parent?: string;
	result?: unknown;
	durationMs?: number;
	error?: string;
}

/**
 * Patch shape — emitted as the worker streams partial results. Mirrors
 * the playground's `EvaluateOutcome` keys so the iframe can merge
 * patches and feed them straight to `<EvaluateResult>`.
 */
export interface PartialOutcomePatch {
	item?: unknown;
	soldPool?: unknown;
	activePool?: unknown;
}

export interface RunEvaluateOptions {
	cfg: ExtensionConfig;
	itemId: string;
	signal: AbortSignal;
	/** Fires once the job id has been minted. Useful for cancel routing. */
	onJobId?: (jobId: string) => void;
	/** Fires on each pipeline step transition with a human-readable label. */
	onStep?: (stepLabel: string) => void;
	/** Full Step record for trace UI — emitted on every started/succeeded/failed event. */
	onTrace?: (step: TraceStep) => void;
	/** Partial outcome merge — fires when a step's result hydrates a piece of the final outcome (item / soldPool / activePool). */
	onPartial?: (patch: PartialOutcomePatch) => void;
}

/**
 * Orchestrate one evaluate run. Throws on cancel / network error /
 * `event: error` / stream timeout. Caller is responsible for handing
 * the resolved `EvaluateResponse` to wherever it should land (cache,
 * UI state, etc.).
 */
export async function runEvaluate(opts: RunEvaluateOptions): Promise<EvaluateResponse> {
	const { cfg, itemId, signal } = opts;
	const jobId = await createEvaluateJob(cfg, itemId, signal);
	opts.onJobId?.(jobId);
	return await streamEvaluateJob(cfg, jobId, opts);
}

/**
 * Structured error thrown by the evaluate engine when an HTTP call
 * fails. Carries the parsed body so UI surfaces can branch on
 * `error.code` (credits_exceeded → upgrade prompt, burst_rate_limited
 * → "slow down" message, anything else → generic retry).
 */
export class EvaluateApiError extends Error {
	readonly status: number;
	readonly code: string | null;
	readonly upgradeUrl: string | null;
	readonly creditsUsed: number | null;
	readonly creditsLimit: number | null;
	constructor(opts: {
		status: number;
		code: string | null;
		message: string;
		upgradeUrl: string | null;
		creditsUsed: number | null;
		creditsLimit: number | null;
	}) {
		super(opts.message);
		this.status = opts.status;
		this.code = opts.code;
		this.upgradeUrl = opts.upgradeUrl;
		this.creditsUsed = opts.creditsUsed;
		this.creditsLimit = opts.creditsLimit;
	}
}

interface ApiErrorBody {
	error?: string;
	message?: string;
	upgrade?: string;
	creditsUsed?: number;
	creditsLimit?: number;
}

async function throwForResponse(res: Response, opName: string): Promise<never> {
	const text = await res.text().catch(() => "");
	const parsed = (text ? safeJson(text) : null) as ApiErrorBody | null;
	const code = parsed?.error ?? null;
	const message = parsed?.message ?? `${opName} → ${res.status}: ${text.slice(0, 240)}`;
	throw new EvaluateApiError({
		status: res.status,
		code,
		message,
		upgradeUrl: parsed?.upgrade ?? null,
		creditsUsed: parsed?.creditsUsed ?? null,
		creditsLimit: parsed?.creditsLimit ?? null,
	});
}

async function createEvaluateJob(cfg: ExtensionConfig, itemId: string, signal: AbortSignal): Promise<string> {
	const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/evaluate/jobs`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: `Bearer ${cfg.apiKey ?? ""}`,
		},
		body: JSON.stringify({ itemId }),
		signal,
	});
	if (!res.ok) await throwForResponse(res, "evaluate_jobs POST");
	const body = (await res.json()) as { id?: string };
	if (!body.id) throw new Error("evaluate_jobs POST: missing id");
	return body.id;
}

/**
 * Read the SSE stream for an evaluate job. Calls back on each
 * intermediate step and resolves with the final `EvaluateResponse`
 * on `event: done`. Falls back to polling `/jobs/{id}` when SSE
 * cannot be opened (rare — proxy in front of the API drops
 * `text/event-stream`). Throws on `event: error`, `event: cancelled`,
 * or stream timeout.
 */
async function streamEvaluateJob(
	cfg: ExtensionConfig,
	jobId: string,
	opts: {
		signal: AbortSignal;
		onStep?: (label: string) => void;
		onTrace?: (step: TraceStep) => void;
		onPartial?: (patch: PartialOutcomePatch) => void;
	},
): Promise<EvaluateResponse> {
	const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/evaluate/jobs/${encodeURIComponent(jobId)}/stream`;
	// Per-call AbortController layered on top of the caller's signal so
	// the timeout doesn't leak into the caller's abort scope.
	const inner = new AbortController();
	const onAbort = () => inner.abort();
	opts.signal.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => inner.abort(), STREAM_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: {
				Accept: "text/event-stream",
				Authorization: `Bearer ${cfg.apiKey ?? ""}`,
			},
			signal: inner.signal,
		});
		if (!res.ok || !res.body) {
			return await pollEvaluateJob(cfg, jobId, opts.signal);
		}
		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += value;
			const events = buffer.split("\n\n");
			buffer = events.pop() ?? "";
			for (const block of events) {
				const parsed = parseSseBlock(block);
				if (!parsed) continue;
				if (parsed.event === "done") {
					return JSON.parse(parsed.data) as EvaluateResponse;
				}
				if (parsed.event === "error") {
					const payload = safeJson(parsed.data) as { error?: string; message?: string } | null;
					throw new Error(payload?.message ?? payload?.error ?? "evaluate failed");
				}
				if (parsed.event === "cancelled") {
					throw new Error("evaluate cancelled");
				}
				dispatchTraceEvent(parsed.event, parsed.data, opts);
			}
		}
		throw new Error("evaluate stream ended without a terminal event");
	} finally {
		clearTimeout(timer);
		opts.signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Translate one SSE step event into the playground's `TraceStep` +
 * partial-outcome patches. Mirrors apps/docs/.../pipelines.ts:610-641
 * so the iframe can render the dashboard's actual `<EvaluateResult>`
 * with hydrating outcome (`item` after the detail step, `soldPool`
 * after `search.sold`, `activePool` after `search.active`).
 */
function dispatchTraceEvent(
	event: string,
	data: string,
	opts: {
		onStep?: (label: string) => void;
		onTrace?: (step: TraceStep) => void;
		onPartial?: (patch: PartialOutcomePatch) => void;
	},
): void {
	const payload = safeJson(data) as {
		key?: string;
		label?: string;
		parent?: string;
		result?: unknown;
		durationMs?: number;
		error?: string;
	} | null;
	if (!payload) return;
	const key = payload.key ?? "step";

	if (event === "started") {
		if (payload.label) opts.onStep?.(payload.label);
		opts.onTrace?.({
			key,
			status: "running",
			label: payload.label,
			parent: payload.parent,
		});
		return;
	}
	if (event === "succeeded") {
		if (payload.label) opts.onStep?.(`${payload.label} ✓`);
		opts.onTrace?.({
			key,
			status: "ok",
			label: payload.label,
			parent: payload.parent,
			result: payload.result,
			durationMs: payload.durationMs,
		});
		// Hydrate partial outcome — same step keys + result shapes the
		// playground extracts in `pipelines.ts` so `<EvaluateResult>`
		// renders identically as the worker streams.
		const r = payload.result;
		if (r && typeof r === "object") {
			if (key === "detail" && "itemId" in (r as Record<string, unknown>)) {
				opts.onPartial?.({ item: r });
			} else if (key === "search.sold") {
				const items = (r as { items?: unknown }).items;
				if (items) opts.onPartial?.({ soldPool: items });
			} else if (key === "search.active") {
				const items = (r as { items?: unknown }).items;
				if (items) opts.onPartial?.({ activePool: items });
			}
		}
		return;
	}
	if (event === "failed") {
		opts.onTrace?.({
			key,
			status: "error",
			label: payload.label,
			parent: payload.parent,
			error: payload.error,
			durationMs: payload.durationMs,
		});
	}
}

async function pollEvaluateJob(cfg: ExtensionConfig, jobId: string, signal: AbortSignal): Promise<EvaluateResponse> {
	const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/evaluate/jobs/${encodeURIComponent(jobId)}`;
	while (!signal.aborted) {
		const res = await fetch(url, {
			headers: { Accept: "application/json", Authorization: `Bearer ${cfg.apiKey ?? ""}` },
			signal,
		});
		if (!res.ok) throw new Error(`evaluate poll → ${res.status}`);
		const body = (await res.json()) as { status?: string; result?: EvaluateResponse; errorMessage?: string };
		if (body.status === "completed" && body.result) return body.result;
		if (body.status === "failed") throw new Error(body.errorMessage ?? "evaluate failed");
		if (body.status === "cancelled") throw new Error("evaluate cancelled");
		await new Promise((r) => setTimeout(r, POLL_FALLBACK_MS));
	}
	throw new Error("evaluate cancelled");
}

function parseSseBlock(block: string): { event: string; data: string } | null {
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

export function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
