/**
 * Playground "Recent" strip — server-backed, cross-surface. Reads
 * `/v1/jobs?kind=<mode>&limit=5` so a row kicked off from the
 * extension, MCP, agent, or SDK shows up here too. No localStorage:
 * the data lives in `compute_jobs` (single source of truth, ML lake +
 * cache + history all in one).
 *
 * Every status (success / failure / cancelled / in_progress) survives
 * page reload. Clicking a row opens it via per-kind get
 * (`GET /v1/evaluate/jobs/{id}` for evaluate). `params` is embedded in
 * the row so one-click re-run doesn't need a second fetch.
 */

import { useCallback, useEffect, useState } from "react";
import { apiBase } from "../../lib/authClient";

export type RecentMode = "evaluate" | "search";

export type RecentStatus = "success" | "failure" | "cancelled" | "in_progress";

export interface RecentRun<Q = unknown> {
	/** compute_jobs row id. */
	id: string;
	mode: RecentMode;
	/** Pre-rendered row label (listing title for evaluate, query for search). */
	label: string;
	/** Original request params — re-feed into the panel for one-click re-run. */
	query: Q;
	timestamp: number;
	status: RecentStatus;
	/** Same as `id`. Kept for back-compat with components that still distinguish. */
	jobId?: string;
}

const CAP = 5;

interface JobSummary {
	id: string;
	kind: RecentMode;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	label: string;
	subLabel?: string;
	imageUrl?: string;
	params: unknown;
	errorCode: string | null;
	createdAt: string;
	completedAt: string | null;
}

function statusOf(s: JobSummary["status"]): RecentStatus {
	if (s === "completed") return "success";
	if (s === "failed") return "failure";
	if (s === "cancelled") return "cancelled";
	return "in_progress";
}

function toRecent<Q>(j: JobSummary): RecentRun<Q> {
	return {
		id: j.id,
		mode: j.kind,
		label: j.label,
		query: j.params as Q,
		timestamp: new Date(j.createdAt).getTime(),
		status: statusOf(j.status),
		jobId: j.id,
	};
}

async function fetchRuns<Q>(mode: RecentMode): Promise<RecentRun<Q>[]> {
	const url = `${apiBase}/v1/jobs?kind=${mode}&limit=${CAP}`;
	try {
		const res = await fetch(url, { credentials: "include" });
		if (!res.ok) return [];
		const body = (await res.json()) as { items?: JobSummary[] };
		return (body.items ?? []).map(toRecent<Q>);
	} catch {
		return [];
	}
}

export function useRecentRuns<Q = unknown>(mode: RecentMode) {
	const [runs, setRuns] = useState<RecentRun<Q>[]>([]);

	const refresh = useCallback(async () => {
		const next = await fetchRuns<Q>(mode);
		setRuns(next);
	}, [mode]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Poll every 3s while any run is in_progress so the strip animates
	// from spinner → check without manual refresh. Cheap (free
	// endpoint, sub-ms server query) and self-stops once all rows
	// terminal.
	useEffect(() => {
		if (!runs.some((r) => r.status === "in_progress")) return;
		const t = setInterval(() => void refresh(), 3000);
		return () => clearInterval(t);
	}, [runs, refresh]);

	return {
		runs,
		/** Trigger a refetch. Components call this after kicking off a new evaluate/search so the queued row appears. */
		refresh,
		/** Local-only clear (server data is permanent). Hides the strip until the next refresh. */
		clear: () => setRuns([]),
		/**
		 * Compatibility shim — server already records every operation via
		 * `runSyncJob` / `createJob`, so explicit add is a refetch.
		 * Existing callers can keep their `recent.add(...)` invocations
		 * unchanged; the hook just resyncs.
		 */
		add: (_run: RecentRun<Q>) => {
			void refresh();
		},
		update: (_id: string, _patch: Partial<RecentRun<Q>>) => {
			void refresh();
		},
	};
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
