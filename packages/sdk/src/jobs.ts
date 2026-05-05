/**
 * `client.jobs.*` — cross-surface, cross-kind activity history.
 *
 * Every billable user-initiated operation (evaluate, search) lands in
 * `compute_jobs` regardless of which surface kicked it off (extension,
 * playground, MCP, agent, this SDK). `client.jobs.list()` returns that
 * activity in a lean per-row shape — call into the per-kind get
 * (`client.evaluate.jobs.get(id)`, etc.) for the heavy result body.
 *
 * Free read; never charged.
 */

import type { ComputeJobKind, ComputeJobStatus, JobListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface JobsListQuery {
	/** Filter by kind. Omit for cross-kind history. */
	kind?: ComputeJobKind;
	/** Filter by lifecycle status. */
	status?: ComputeJobStatus;
	/** ISO timestamp lower bound on `createdAt`. */
	since?: string;
	/** Keyset paging cursor — pass the previous response's `cursor`. */
	cursor?: string;
	/** Default 20, max 100. */
	limit?: number;
}

export interface JobsClient {
	list(query?: JobsListQuery): Promise<JobListResponse>;
}

export function createJobsClient(http: FlipagentHttp): JobsClient {
	return {
		list: (query) => {
			const params = new URLSearchParams();
			if (query?.kind) params.set("kind", query.kind);
			if (query?.status) params.set("status", query.status);
			if (query?.since) params.set("since", query.since);
			if (query?.cursor) params.set("cursor", query.cursor);
			if (query?.limit !== undefined) params.set("limit", String(query.limit));
			const qs = params.toString();
			return http.get(`/v1/jobs${qs ? `?${qs}` : ""}`);
		},
	};
}
