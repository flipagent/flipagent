/**
 * Per-mode recent-runs store. Persists to localStorage so the user
 * comes back to the playground and sees their last few queries — one
 * click to re-run.
 *
 * Capped at 5 per mode. Re-running an identical query bumps the
 * timestamp instead of creating a duplicate (deduped by `id`).
 */

import { useEffect, useState } from "react";

export type RecentMode = "discover" | "evaluate";

export interface RecentRun<Q = unknown> {
	id: string;
	mode: RecentMode;
	/** Human-readable summary shown in the row, e.g. "Wristwatches under $300". */
	label: string;
	/** Inputs to feed back into the panel for one-click re-run. */
	query: Q;
	timestamp: number;
	/** Optional outcome blurb, e.g. "24 deals" or "BUY · 78%". */
	summary?: string;
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

	function clear() {
		setRuns([]);
		try {
			window.localStorage.removeItem(key);
		} catch {
			/* ignore */
		}
	}

	return { runs, add, clear };
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
