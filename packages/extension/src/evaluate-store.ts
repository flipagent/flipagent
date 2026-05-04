/**
 * Per-itemId evaluate state store. Mirrors the playground's
 * `evalStore` (apps/docs/src/components/playground/evalStore.ts) so the
 * on-page UX feels identical — N rows can run concurrently, each with
 * its own progress + verdict, and any UI surface (the floating chip
 * on /itm, the per-row buttons on /sch) subscribes by itemId.
 *
 * No concurrency cap: an evaluate job is a server-side compute_jobs
 * row, the worker pool throttles execution. The client only kicks off
 * the request; bandwidth + credits are the user's gate.
 */

import type { EvaluateResponse } from "@flipagent/types";
import {
	EvaluateApiError,
	errorMessage,
	type PartialOutcomePatch,
	runEvaluate,
	type TraceStep,
} from "./evaluate-engine.js";
import { loadConfig } from "./shared.js";
import {
	clearPartialOutcome,
	clearRunningEval,
	type EvalCacheEntry,
	RUNNING_MIRROR_TTL_MS,
	readEvalCache,
	readRunningEval,
	setRunningEval,
	writeEvalCache,
	writePartialError,
	writePartialOutcome,
} from "./storage.js";

export interface EvalErrorDetails {
	message: string;
	/** Surfaces the API's structured error code (credits_exceeded /
	 * burst_rate_limited / etc) so UI can branch — e.g. show an
	 * "Upgrade" CTA on credits_exceeded instead of a plain Retry. */
	code: string | null;
	/** Pre-built upgrade URL (when the host has Stripe wired). */
	upgradeUrl: string | null;
}

export type EvalState =
	| { kind: "idle" }
	| { kind: "running"; abort: AbortController; jobId?: string; stepLabel: string; mirrored?: boolean }
	| { kind: "done"; result: EvaluateResponse; cached: boolean; jobId?: string }
	| ({ kind: "error" } & EvalErrorDetails);

const states = new Map<string, EvalState>();
const subscribers = new Map<string, Set<() => void>>();

export function subscribe(itemId: string, listener: () => void): () => void {
	let bucket = subscribers.get(itemId);
	if (!bucket) {
		bucket = new Set();
		subscribers.set(itemId, bucket);
	}
	bucket.add(listener);
	return () => {
		bucket?.delete(listener);
	};
}

function setState(itemId: string, next: EvalState): void {
	states.set(itemId, next);
	mirrorRunningToStorage(itemId, next);
	const bucket = subscribers.get(itemId);
	if (!bucket) return;
	for (const fn of bucket) {
		try {
			fn();
		} catch {
			/* listener errors don't break the store */
		}
	}
}

/**
 * Cross-context mirror — popup runs in its own document and can't read
 * this in-process Map, so we project the running set to chrome.storage.
 * The popup's NOW panel reads it + subscribes to onChanged for live
 * updates. Storage shape (key, schema, helpers) lives in storage.ts.
 */
function mirrorRunningToStorage(itemId: string, next: EvalState): void {
	if (next.kind === "running") {
		void setRunningEval(itemId, { stepLabel: next.stepLabel, jobId: next.jobId }).catch(() => {});
	} else {
		void clearRunningEval(itemId).catch(() => {});
	}
}

/**
 * Read the user-visible state for an itemId from any source — local
 * Map first (this tab is the runner), then the cross-tab `running`
 * mirror (another tab is running), then the persisted cache (someone
 * finished within TTL). UI surfaces use this so a detail page that
 * opens after the SRP row started running picks up the in-flight
 * progress immediately.
 *
 * Cross-tab running entries carry `mirrored: true` because their
 * AbortController is owned by the originating tab — UI hides the
 * Cancel button on those (the user cancels from the originating
 * surface). When the runner tab finishes, the cache write triggers a
 * storage onChanged that callers re-read here as `done`.
 */
export async function readVisibleState(itemId: string): Promise<EvalState> {
	const local = states.get(itemId);
	if (local && local.kind !== "idle") return local;

	const running = await readRunningEval(itemId);
	if (running) {
		const age = Date.now() - new Date(running.startedAt).getTime();
		if (Number.isFinite(age) && age < RUNNING_MIRROR_TTL_MS) {
			return {
				kind: "running",
				abort: new AbortController(),
				jobId: running.jobId,
				stepLabel: running.stepLabel,
				mirrored: true,
			};
		}
	}

	const entry = await readEvalCache(itemId).catch(() => null);
	if (entry) {
		return {
			kind: "done",
			result: entry.result as EvaluateResponse,
			cached: true,
			jobId: entry.jobId,
		};
	}

	return { kind: "idle" };
}

/**
 * Cross-surface auto-attach. If another flipagent surface (the
 * dashboard playground, an MCP client) already started an evaluate
 * for this itemId on the server, attach to the same job's stream so
 * the user sees the live trace + progress here too — no second click,
 * no duplicate run, no stale "idle" state.
 *
 * No-op when the server has no in-progress job, or when this tab
 * already has a non-idle state (running locally, cached, errored).
 * Server-side `POST /v1/evaluate/jobs` is idempotent on
 * `(apiKey, itemId)`, so calling `startEvaluate` here just attaches
 * to the existing job rather than spawning a new one.
 */
export async function attachActiveIfAny(itemId: string): Promise<void> {
	const cur = states.get(itemId);
	if (cur && cur.kind !== "idle") return;
	const cfg = await loadConfig();
	if (!cfg.apiKey) return;
	try {
		const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/evaluate/active?itemId=${encodeURIComponent(itemId)}`;
		const res = await fetch(url, { headers: { "X-Api-Key": cfg.apiKey } });
		if (!res.ok) return;
		const body = (await res.json()) as { id?: string; status?: string } | null;
		if (!body?.id) return;
		// Active job exists server-side. Kick off our local pipeline —
		// the server-side idempotency check returns the existing
		// jobId, so we attach to its stream + mirror its progress.
		await startEvaluate(itemId);
	} catch {
		/* network error / api key invalid — silently skip; user can still click Evaluate manually */
	}
}

/**
 * Kick off an evaluate run for the given itemId. No-op if one is
 * already running. Stores the final result in cache + the per-itemId
 * state. Subscribers see step transitions + the terminal state.
 */
export async function startEvaluate(itemId: string): Promise<void> {
	const cur = states.get(itemId);
	if (cur?.kind === "running") return;

	const cfg = await loadConfig();
	if (!cfg.apiKey) {
		setState(itemId, { kind: "error", message: "Sign in to flipagent first.", code: null, upgradeUrl: null });
		return;
	}

	const abort = new AbortController();
	setState(itemId, { kind: "running", abort, stepLabel: "Queueing evaluate job…" });

	// Reset the partial-outcome mirror — old hydration from a prior
	// run for this item could otherwise paint the side panel with
	// stale data while the new run is still warming up.
	void clearPartialOutcome(itemId).catch(() => {});

	const partial: Record<string, unknown> = {};
	const trace: TraceStep[] = [];

	try {
		const result = await runEvaluate({
			cfg,
			itemId,
			signal: abort.signal,
			onJobId: (jobId) => {
				const s = states.get(itemId);
				if (s?.kind === "running") {
					setState(itemId, { ...s, jobId });
				}
			},
			onStep: (label) => {
				const s = states.get(itemId);
				if (s?.kind === "running") {
					setState(itemId, { ...s, stepLabel: label });
				}
			},
			onTrace: (step) => {
				// Merge into any earlier step with the same key (started →
				// ok path), otherwise append. Keeps the trace array in
				// chronological order with at most one entry per key.
				// Merge — not replace — because the backend's `succeeded`
				// event omits `label` / `parent` (they're carried by the
				// prior `started` event); a naive replace blanks them.
				const idx = trace.findIndex((s) => s.key === step.key);
				if (idx >= 0) {
					const prev = trace[idx];
					if (!prev) {
						trace[idx] = step;
					} else {
						const merged: TraceStep = { ...prev, ...step };
						if (step.label === undefined && prev.label !== undefined) merged.label = prev.label;
						if (step.parent === undefined && prev.parent !== undefined) merged.parent = prev.parent;
						trace[idx] = merged;
					}
				} else {
					trace.push(step);
				}
				void writePartialOutcome(itemId, partial, trace).catch(() => {});
			},
			onPartial: (patch: PartialOutcomePatch) => {
				if (patch.item !== undefined) partial.item = patch.item;
				if (patch.soldPool !== undefined) partial.soldPool = patch.soldPool;
				if (patch.activePool !== undefined) partial.activePool = patch.activePool;
				void writePartialOutcome(itemId, partial, trace).catch(() => {});
			},
		});
		const s = states.get(itemId);
		const jobId = s?.kind === "running" ? s.jobId : undefined;
		await writeEvalCache(itemId, {
			result,
			completedAt: new Date().toISOString(),
			jobId,
			// Persist the trace alongside the result so the cached side
			// panel still renders a full Trace expander — without this,
			// `Hide trace` opens an empty `<ol class="pg-trace">` and
			// reads as if the section was clipped.
			steps: trace.slice(),
		} satisfies EvalCacheEntry).catch(() => {});
		// Cache covers the side panel from here on — drop the partial
		// mirror so subsequent renders read the canonical full result.
		void clearPartialOutcome(itemId).catch(() => {});
		setState(itemId, { kind: "done", result, cached: false, jobId });
	} catch (err) {
		const apiErr = err instanceof EvaluateApiError ? err : null;
		const errorInfo = {
			message: errorMessage(err),
			code: apiErr?.code ?? null,
			upgradeUrl: apiErr?.upgradeUrl ?? null,
		};
		// Flip any still-running step in the trace to error so the side
		// panel renders the failure visually (red pill on the failed
		// step, not a stuck spinner). Mirrors the playground pattern.
		for (const step of trace) {
			if (step.status === "running") step.status = "error";
		}
		// Persist the trace + the partial outcome we collected so far,
		// stamped with the error. Side panel keeps the full
		// `<EvaluateResult>` + Trace visible so the user sees WHERE the
		// pipeline failed, not just a generic message.
		void writePartialOutcome(itemId, partial, trace).catch(() => {});
		void writePartialError(itemId, errorInfo).catch(() => {});
		setState(itemId, { kind: "error", ...errorInfo });
	}
}

/**
 * Cancel a running evaluate. The aborted fetch surfaces inside
 * `runEvaluate` and the catch branch of `startEvaluate` lands the
 * row back to error → caller can re-run via `startEvaluate`. We
 * collapse to idle here so the row reverts cleanly.
 */
export function cancelEvaluate(itemId: string): void {
	const cur = states.get(itemId);
	if (cur?.kind !== "running") return;
	cur.abort.abort();
	setState(itemId, { kind: "idle" });
}

/**
 * Hard reset for an itemId — used by "Re-evaluate" UI to drop a
 * cached / errored state and let the next `startEvaluate` start
 * fresh. Subscribers re-render to the idle slot.
 */
export function resetEvaluate(itemId: string): void {
	const cur = states.get(itemId);
	if (cur?.kind === "running") cur.abort.abort();
	setState(itemId, { kind: "idle" });
}
