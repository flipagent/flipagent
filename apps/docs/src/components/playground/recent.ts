/**
 * Per-mode recent-runs store. Persists to localStorage as a "recent
 * results" log: every status (success / failure / cancelled /
 * in_progress) survives reload, and clicking a row opens the saved job
 * via `/v1/evaluate/jobs/{id}` — resume the live stream when still in
 * progress, hydrate the saved result otherwise.
 *
 * Capped at 5 per mode. Re-running an identical query bumps the
 * timestamp + flips status back to `in_progress` (deduped by `id`).
 *
 * `status` follows GitHub Actions semantics — success / failure /
 * cancelled / in_progress — so the strip can render a state pill
 * (orange check / red ✕ / dim ⊘ / brand spinner).
 */

import { useEffect, useState } from "react";

export type RecentMode = "evaluate" | "search";

export type RecentStatus = "success" | "failure" | "cancelled" | "in_progress";

export interface RecentRun<Q = unknown> {
	id: string;
	mode: RecentMode;
	/** Human-readable label shown in the row, e.g. the listing title or query. */
	label: string;
	/** Inputs to feed back into the panel for one-click re-run. */
	query: Q;
	timestamp: number;
	status: RecentStatus;
	/**
	 * compute_jobs row id. Lets the panel resume an in-progress run
	 * (`/jobs/{id}/stream` replays trace) or hydrate a terminal run
	 * (`GET /jobs/{id}` returns saved result). Absent on legacy entries
	 * created before the queue refactor — the panel falls back to a
	 * fresh query rerun in that case.
	 */
	jobId?: string;
}

const CAP = 5;

function storageKey(mode: RecentMode): string {
	return `flipagent.recent.${mode}`;
}

function safeParse<Q>(raw: string | null): RecentRun<Q>[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function useRecentRuns<Q = unknown>(mode: RecentMode) {
	const key = storageKey(mode);
	const [runs, setRuns] = useState<RecentRun<Q>[]>(() =>
		typeof window === "undefined" ? [] : safeParse<Q>(window.localStorage.getItem(key)),
	);

	// Stay in sync with other tabs / panels writing the same key.
	useEffect(() => {
		function onStorage(e: StorageEvent) {
			if (e.key === key) setRuns(safeParse<Q>(e.newValue));
		}
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [key]);

	function add(run: RecentRun<Q>) {
		setRuns((prev) => {
			const next = [run, ...prev.filter((r) => r.id !== run.id)].slice(0, CAP);
			try {
				window.localStorage.setItem(key, JSON.stringify(next));
			} catch {
				// quota / private mode — non-fatal
			}
			return next;
		});
	}

	/**
	 * Patch one entry in place — primary use is the boot sweep that
	 * reconciles `in_progress` rows with the server's actual status via
	 * `GET /jobs/{id}`. Same persistence semantics as `add`.
	 */
	function update(id: string, patch: Partial<RecentRun<Q>>) {
		setRuns((prev) => {
			const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
			try {
				window.localStorage.setItem(key, JSON.stringify(next));
			} catch {
				/* non-fatal */
			}
			return next;
		});
	}

	function clear() {
		setRuns([]);
		try {
			window.localStorage.removeItem(key);
		} catch {
			/* ignore */
		}
	}

	return { runs, add, update, clear };
}

export function timeAgo(ts: number): string {
	const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	return `${d}d ago`;
}
