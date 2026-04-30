/**
 * On mount, reconcile any persisted `in_progress` Recent rows with the
 * server's actual job status. Without this the strip would show stale
 * spinners forever for jobs that completed (or failed/cancelled) while
 * the tab was closed.
 *
 * Pure read — never replays content. The user clicking the row is what
 * triggers a stream resubscribe (PlaygroundEvaluate / PlaygroundDiscover
 * own that handler). This hook is just the catch-up.
 */

import { useEffect } from "react";
import { type ComputeJobKind, fetchJobStatus } from "./pipelines";
import type { RecentRun, RecentStatus, useRecentRuns } from "./recent";

type RecentApi<Q> = ReturnType<typeof useRecentRuns<Q>>;

export function useResumeSweep<Q>(kind: ComputeJobKind, recent: RecentApi<Q>) {
	// Snapshot the strip at mount; later additions are fresh runs that
	// don't need reconciliation.
	useEffect(() => {
		for (const r of recent.runs) {
			if (r.status !== "in_progress" || !r.jobId) continue;
			const jobId = r.jobId;
			void fetchJobStatus(kind, jobId).then((server) => {
				const next = serverStatusToRecent(server?.status);
				if (next != null) recent.update(r.id, { status: next });
			});
		}
		// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
	}, []);
}

function serverStatusToRecent(
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | undefined,
): RecentStatus | null {
	if (status === "completed") return "success";
	if (status === "failed") return "failure";
	if (status === "cancelled") return "cancelled";
	// 404 from the server (status === undefined) — the row expired or
	// never existed. Mirror as cancelled so the spinner resolves.
	if (status === undefined) return "cancelled";
	// queued / running — still in flight, leave the spinner alone.
	return null;
}

// Re-export for convenience so panels don't need a separate import.
export type { RecentRun };
