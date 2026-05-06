/**
 * Per-itemId shared eval state — module-level store the SearchRow's
 * inline button and the RowDrawer's full result UI both read from. So
 * starting an eval from the row shows running progress in the drawer
 * the moment the user opens it, and starting one from the drawer
 * flips the row's button to Cancel automatically. Everything stays
 * in sync without prop drilling or shared parent state.
 *
 * Shape: a Map<itemId, EvalState> + a Map<itemId, listenerSet> so
 * components subscribe per-itemId (cheaper than re-rendering on any
 * change anywhere). The hook below adapts this to React via
 * `useSyncExternalStore`.
 *
 * Lifecycle: states persist across drawer open/close — user can
 * navigate away and come back to the same item with state intact.
 * They reset only on full page reload (no eviction; the working set
 * is small enough that growing the Map for a session is fine).
 */

import { useSyncExternalStore } from "react";
import { hasMockEvaluateFixture } from "./mockData";
import {
	EVALUATE_STEPS,
	type EvaluateOutcome,
	friendlyErrorMessage,
	initialSteps,
	runEvaluate,
	runEvaluateMock,
	toBannerError,
} from "./pipelines";
import type { Step } from "./types";

export type EvalState =
	| { status: "idle" }
	| {
			status: "running";
			controller: AbortController;
			outcome: Partial<EvaluateOutcome>;
			steps: Step[];
		}
	| {
			status: "complete";
			outcome: EvaluateOutcome;
			steps: Step[];
		}
	| {
			status: "error";
			message: string;
			upgradeUrl?: string;
		};

const IDLE: EvalState = { status: "idle" };

const states = new Map<string, EvalState>();
const listeners = new Map<string, Set<() => void>>();

export function getEvalState(itemId: string): EvalState {
	return states.get(itemId) ?? IDLE;
}

function setState(itemId: string, next: EvalState | ((prev: EvalState) => EvalState)): void {
	const prev = states.get(itemId) ?? IDLE;
	const updated = typeof next === "function" ? next(prev) : next;
	if (updated.status === "idle") {
		states.delete(itemId);
	} else {
		states.set(itemId, updated);
	}
	const set = listeners.get(itemId);
	if (set) for (const l of set) l();
}

function subscribe(itemId: string, listener: () => void): () => void {
	let set = listeners.get(itemId);
	if (!set) {
		set = new Set();
		listeners.set(itemId, set);
	}
	set.add(listener);
	return () => {
		set?.delete(listener);
		if (set && set.size === 0) listeners.delete(itemId);
	};
}

/**
 * React hook — subscribes a component to one item's eval state. The
 * server snapshot returns the singleton IDLE so SSR doesn't try to
 * read from the (browser-only) Map.
 */
export function useEvalState(itemId: string): EvalState {
	return useSyncExternalStore(
		(cb) => subscribe(itemId, cb),
		() => getEvalState(itemId),
		() => IDLE,
	);
}

/**
 * Decide whether to gate this run on /signup. The logged-out hero
 * runs in mockMode — non-curated reps don't have a fixture, and
 * mocking would clone unrelated data under the wrong title. For
 * those, bounce to /signup instead. Returns the redirect URL when
 * a bounce is needed, null otherwise.
 */
function maybeSignupRedirect(itemId: string, mockMode: boolean): string | null {
	if (!mockMode) return null;
	if (hasMockEvaluateFixture(itemId)) return null;
	if (typeof window === "undefined") return null;
	const ret = window.location.pathname + window.location.search;
	return `/signup/?return=${encodeURIComponent(ret)}`;
}

/**
 * Kick off an eval for `itemId`. No-op if already running for the
 * same item (so the same button can be re-clicked safely without
 * spawning duplicates). Returns the controller so the caller can
 * also abort if needed; the cancel helper below is the usual entry.
 *
 * On `complete` / `error` / `cancelled`, the store transitions
 * exactly once — in-flight `onStep` / `onPartial` updates after
 * cancellation are ignored.
 */
export async function runEvalForItem(itemId: string, mockMode: boolean): Promise<void> {
	const existing = getEvalState(itemId);
	if (existing.status === "running") return;

	const redirect = maybeSignupRedirect(itemId, mockMode);
	if (redirect) {
		window.location.href = redirect;
		return;
	}

	const controller = new AbortController();
	setState(itemId, {
		status: "running",
		controller,
		outcome: {},
		steps: initialSteps(EVALUATE_STEPS),
	});

	const runner = mockMode ? runEvaluateMock : runEvaluate;
	try {
		const result = await runner(
			{ itemId },
			{
				onStep: (key, p) => {
					setState(itemId, (prev) => {
						if (prev.status !== "running" || prev.controller !== controller) return prev;
						const idx = prev.steps.findIndex((s) => s.key === key);
						const newSteps =
							idx >= 0
								? prev.steps.map((s, i) => (i === idx ? { ...s, ...p } : s))
								: [...prev.steps, { key, label: p.label ?? key, status: p.status ?? "pending", ...p }];
						return { ...prev, steps: newSteps };
					});
				},
				onPartial: (patch) => {
					setState(itemId, (prev) => {
						if (prev.status !== "running" || prev.controller !== controller) return prev;
						return { ...prev, outcome: { ...prev.outcome, ...patch } };
					});
				},
			},
			controller.signal,
		);

		// Only commit terminal state if we still own this run — protects
		// against a stale completion landing after a cancel + restart.
		const cur = getEvalState(itemId);
		const stillOurs = cur.status === "running" && cur.controller === controller;
		if (!stillOurs) return;

		if (result.kind === "success") {
			setState(itemId, {
				status: "complete",
				outcome: result.value,
				steps: cur.steps.map((s) => (s.status === "running" || s.status === "pending" ? { ...s, status: "ok" } : s)),
			});
		} else if (result.kind === "cancelled") {
			setState(itemId, IDLE);
		} else {
			const friendly = friendlyErrorMessage(result.message, result.code);
			setState(itemId, { status: "error", message: friendly });
		}
	} catch (caught) {
		const cur = getEvalState(itemId);
		if (cur.status === "running" && cur.controller === controller) {
			const banner = toBannerError(caught);
			setState(itemId, {
				status: "error",
				message: banner.message,
				upgradeUrl: banner.upgradeUrl,
			});
		}
	}
}

/**
 * Abort whatever's running for `itemId`, transitioning the store to
 * idle. The `runEvalForItem` Promise above sees the cancellation
 * and exits without overwriting the idle state.
 */
export function cancelEvalForItem(itemId: string): void {
	const state = getEvalState(itemId);
	if (state.status !== "running") return;
	state.controller.abort();
	setState(itemId, IDLE);
}

/** Reset to idle from any state — used by Re-run (clears stale complete/error before starting over). */
export function resetEvalForItem(itemId: string): void {
	const state = getEvalState(itemId);
	if (state.status === "running") state.controller.abort();
	setState(itemId, IDLE);
}

/**
 * Seed the store with a previously-computed `EvaluateOutcome` so the drawer
 * lands in the "complete" branch the moment it opens. Used by surfaces
 * that hold cached results and don't want to re-run the pipeline (deals
 * table, recent-runs reopen, etc.). Aborts any in-flight run for this
 * itemId first so seeded data doesn't get clobbered by a stale
 * completion. The synthesised steps array marks every pipeline stage
 * `ok`, so the trace renders without "in progress" noise.
 */
export function seedEvalForItem(itemId: string, outcome: EvaluateOutcome): void {
	const state = getEvalState(itemId);
	if (state.status === "running") state.controller.abort();
	const steps = initialSteps(EVALUATE_STEPS).map((s) => ({ ...s, status: "ok" as const }));
	setState(itemId, { status: "complete", outcome, steps });
}
