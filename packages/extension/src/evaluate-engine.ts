/**
 * Evaluate engine — pure HTTP plumbing shared by every on-page evaluate
 * surface (the floating chip on `/itm/{id}`, the per-row buttons on
 * `/sch/...`). Mirrors the playground's `runEvaluate` contract: the
 * caller passes an itemId + abort signal + step / partial callbacks,
 * we POST `/v1/evaluate/jobs`, then drive the SDK's typed event stream
 * until the worker emits `done` / `error` / `cancelled`.
 *
 * Stays free of UI concerns — no DOM, no styles. Surfaces compose this
 * engine with their own per-itemId state + render logic. SSE parsing
 * and polling fallback live in `@flipagent/sdk/streams.ts` so this
 * file is just the thin extension-side wiring.
 */

import { streamEvaluateJob } from "@flipagent/sdk/streams";
import type { EvaluatePartial, EvaluateResponse } from "@flipagent/types";
import type { ExtensionConfig } from "./shared.js";

/**
 * One trace step — mirrors apps/docs/.../playground/types.ts `Step`
 * shape so we can hand the steps array to the playground component
 * unchanged. The key/label/parent/result fields come straight from
 * the SDK's collapsed trace step (started + succeeded merged into
 * one row, status derived).
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
 * Run-time options for `runEvaluate`. The engine is pure transport —
 * it doesn't compute phase labels or merge partial state itself.
 * Consumers attach to the typed event channels and own their own
 * derived state (the store accumulates the partial and runs
 * `describeEvaluatePhase` for the chip).
 */
export interface RunEvaluateOptions {
	cfg: ExtensionConfig;
	itemId: string;
	signal: AbortSignal;
	/** Fires once the job id has been minted. Useful for cancel routing. */
	onJobId?: (jobId: string) => void;
	/** Fires on every step lifecycle change — one row per `key`, status progressing running → ok | error. */
	onStep?: (step: TraceStep) => void;
	/** Typed state-hydration patch — fires whenever the server emits a `partial` event. Spread into the outcome state. */
	onPartial?: (patch: Partial<EvaluatePartial>) => void;
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
	return await consumeStream(cfg, jobId, opts);
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
	/**
	 * Structured payload from the failing pipeline step. `variation_required`
	 * carries `{ legacyId, variations[], parentImageUrl?, parentTitle? }`
	 * so the side-panel can render a SKU picker instead of just an error.
	 * Treat as opaque at the engine layer; consumers shape it.
	 */
	readonly details: unknown;
	constructor(opts: {
		status: number;
		code: string | null;
		message: string;
		upgradeUrl: string | null;
		creditsUsed: number | null;
		creditsLimit: number | null;
		details?: unknown;
	}) {
		super(opts.message);
		this.status = opts.status;
		this.code = opts.code;
		this.upgradeUrl = opts.upgradeUrl;
		this.creditsUsed = opts.creditsUsed;
		this.creditsLimit = opts.creditsLimit;
		this.details = opts.details ?? null;
	}
}

interface ApiErrorBody {
	error?: string;
	message?: string;
	upgrade?: string;
	creditsUsed?: number;
	creditsLimit?: number;
	details?: unknown;
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
		details: parsed?.details,
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
 * Consume the SDK's typed event stream. Each kind is forwarded to its
 * dedicated callback verbatim — no derived state, no label
 * synthesis. The store layer accumulates the partial and runs
 * `describeEvaluatePhase` itself when it needs a chip label.
 */
async function consumeStream(cfg: ExtensionConfig, jobId: string, opts: RunEvaluateOptions): Promise<EvaluateResponse> {
	const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
	const apiKey = cfg.apiKey ?? "";

	const stream = streamEvaluateJob({
		jobId,
		fetcher: (path, init) =>
			fetch(`${baseUrl}${path}`, {
				...init,
				headers: {
					...((init?.headers as Record<string, string>) ?? {}),
					Authorization: `Bearer ${apiKey}`,
				},
			}),
		signal: opts.signal,
	});

	for await (const evt of stream) {
		switch (evt.kind) {
			case "step":
				opts.onStep?.({
					key: evt.step.key,
					status: evt.step.status,
					...(evt.step.label !== undefined ? { label: evt.step.label } : {}),
					...(evt.step.parent !== undefined ? { parent: evt.step.parent } : {}),
					...(evt.step.result !== undefined ? { result: evt.step.result } : {}),
					...(evt.step.durationMs !== undefined ? { durationMs: evt.step.durationMs } : {}),
					...(evt.step.error !== undefined ? { error: evt.step.error } : {}),
				});
				break;
			case "partial":
				opts.onPartial?.(evt.patch);
				break;
			case "done":
				return evt.result;
			case "error":
				throw new EvaluateApiError({
					status: 0,
					code: evt.error.code,
					message: evt.error.message,
					upgradeUrl:
						evt.error.details && typeof evt.error.details === "object"
							? ((evt.error.details as { upgrade?: string }).upgrade ?? null)
							: null,
					creditsUsed: null,
					creditsLimit: null,
					details: evt.error.details,
				});
			case "cancelled":
				throw new Error("evaluate cancelled");
		}
	}
	throw new Error("evaluate stream ended without a terminal event");
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

/** Caller-friendly message extraction for thrown errors. Used by
 *  evaluate-store to render the panel's error banner — keeps the
 *  failure-path branching out of consumers. */
export function errorMessage(err: unknown): string {
	if (err instanceof EvaluateApiError) return err.message;
	if (err instanceof Error) return err.message;
	return String(err);
}
