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
import { errorMessage, runEvaluate } from "./evaluate-engine.js";
import { type EvalCacheEntry, loadConfig, readEvalCache, writeEvalCache } from "./shared.js";

export type EvalState =
	| { kind: "idle" }
	| { kind: "running"; abort: AbortController; jobId?: string; stepLabel: string; mirrored?: boolean }
	| { kind: "done"; result: EvaluateResponse; cached: boolean; jobId?: string }
	| { kind: "error"; message: string };

const states = new Map<string, EvalState>();
const subscribers = new Map<string, Set<() => void>>();

/**
 * The currently-open detail drawer. Mirrors the playground's RowDrawer
 * `selected` state — clicking "View" on any row sets this; the drawer
 * singleton mounts/unmounts in response.
 */
let openItemId: string | null = null;
const drawerSubscribers = new Set<() => void>();

export function getState(itemId: string): EvalState {
	return states.get(itemId) ?? { kind: "idle" };
}

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

export function getOpenItemId(): string | null {
	return openItemId;
}

export function subscribeDrawer(listener: () => void): () => void {
	drawerSubscribers.add(listener);
	return () => {
		drawerSubscribers.delete(listener);
	};
}

export function setOpenItemId(itemId: string | null): void {
	if (openItemId === itemId) return;
	openItemId = itemId;
	for (const fn of drawerSubscribers) {
		try {
			fn();
		} catch {
			/* listener errors don't break the store */
		}
	}
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
 * The popup's NOW panel reads `flipagent_running_evals` + subscribes to
 * its `onChanged` for live updates.
 *
 * Entry shape is intentionally minimal — popup needs the step label and
 * a start timestamp for staleness pruning, nothing else. Job-id is
 * included for diagnostic display only.
 */
const RUNNING_KEY = "flipagent_running_evals";

interface RunningMirrorEntry {
	stepLabel: string;
	jobId?: string;
	startedAt: string;
}

function mirrorRunningToStorage(itemId: string, next: EvalState): void {
	void chrome.storage.local.get([RUNNING_KEY]).then((stored) => {
		const map = { ...((stored[RUNNING_KEY] ?? {}) as Record<string, RunningMirrorEntry>) };
		const had = itemId in map;
		if (next.kind === "running") {
			map[itemId] = {
				stepLabel: next.stepLabel,
				jobId: next.jobId,
				startedAt: had ? map[itemId].startedAt : new Date().toISOString(),
			};
		} else if (had) {
			delete map[itemId];
		} else {
			return; // nothing to write
		}
		void chrome.storage.local.set({ [RUNNING_KEY]: map }).catch(() => {});
	});
}

/**
 * Hydrate idle state from cache without spending a credit. Surfaces
 * the cached result as `{ kind: "done", cached: true }` so subscribers
 * can show the verdict directly. Returns true if a cached result was
 * applied. No-op if a job is already running for this itemId.
 */
export async function hydrateFromCache(itemId: string): Promise<boolean> {
	const cur = states.get(itemId);
	if (cur && cur.kind !== "idle") return false;
	const entry = await readEvalCache(itemId).catch(() => null);
	if (!entry) return false;
	setState(itemId, {
		kind: "done",
		result: entry.result as EvaluateResponse,
		cached: true,
		jobId: entry.jobId,
	});
	return true;
}

/**
 * Read the user-visible state for an itemId from any source — local
 * Map first (this tab is the runner), then the cross-tab `running`
 * mirror in storage (another tab is running), then the persisted
 * cache (someone finished within TTL). UI surfaces use this so a
 * detail page that opens after the SRP row started running picks up
 * the in-flight progress immediately.
 *
 * Cross-tab running entries carry `mirrored: true` because their
 * AbortController is owned by the originating tab — UI hides the
 * Cancel button on those (the user cancels from the originating
 * surface). When the runner tab finishes, the cache write triggers a
 * storage onChanged that callers re-read here as `done`.
 */
const RUNNING_MIRROR_TTL_MS = 6 * 60_000;

export async function readVisibleState(itemId: string): Promise<EvalState> {
	const local = states.get(itemId);
	if (local && local.kind !== "idle") return local;

	const stored = await chrome.storage.local.get([RUNNING_KEY]);
	const running = stored[RUNNING_KEY]?.[itemId] as RunningMirrorEntry | undefined;
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
 * Kick off an evaluate run for the given itemId. No-op if one is
 * already running. Stores the final result in cache + the per-itemId
 * state. Subscribers see step transitions + the terminal state.
 */
export async function startEvaluate(itemId: string): Promise<void> {
	const cur = states.get(itemId);
	if (cur?.kind === "running") return;

	const cfg = await loadConfig();
	if (!cfg.apiKey) {
		setState(itemId, { kind: "error", message: "Sign in to flipagent first." });
		return;
	}

	const abort = new AbortController();
	setState(itemId, { kind: "running", abort, stepLabel: "Queueing evaluate job…" });

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
		});
		const s = states.get(itemId);
		const jobId = s?.kind === "running" ? s.jobId : undefined;
		await writeEvalCache(itemId, {
			result,
			completedAt: new Date().toISOString(),
			jobId,
		} satisfies EvalCacheEntry).catch(() => {});
		setState(itemId, { kind: "done", result, cached: false, jobId });
	} catch (err) {
		setState(itemId, { kind: "error", message: errorMessage(err) });
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
