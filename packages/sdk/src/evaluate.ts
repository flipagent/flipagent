/**
 * `client.evaluate.*` — id-driven single-listing judgment. flipagent's
 * Decisions pillar over HTTP. Pass an `itemId` and the server fetches
 * the detail, derives sold + active matched listings, and returns the
 * evaluation plus a `meta` block describing what was fetched. Math runs
 * server-side so all language SDKs return identical evaluations.
 *
 * Three surfaces:
 *   .listing(req)        — sync. Awaits the full pipeline and returns
 *                          `EvaluateResponse` (digest + back-compat
 *                          pools). Right call for one-shot agents and
 *                          notebooks.
 *   .pool(itemId)        — drill-down companion. Returns
 *                          `EvaluatePoolResponse` (kept + rejected
 *                          listings with per-item reason). Cache-only;
 *                          requires a recent `.listing()` call within
 *                          the cache TTL or it 412s.
 *   .jobs.create/get/cancel — async. Job lives 7d, survives client
 *                          disconnect, supports cooperative cancel.
 *                          Right call when you want a UI that streams
 *                          progress or a backgrounded task.
 */

import type {
	ComputeJobAck,
	EvaluateJob,
	EvaluatePoolResponse,
	EvaluateRequest,
	EvaluateResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";
import { type EvaluateStreamEvent, streamEvaluateJob } from "./streams.js";

export interface EvaluateJobsClient {
	create(req: EvaluateRequest): Promise<ComputeJobAck>;
	get(id: string): Promise<EvaluateJob>;
	cancel(id: string): Promise<ComputeJobAck>;
	/**
	 * Subscribe to a job's live event stream. Yields trace, partial,
	 * and terminal events in arrival order. Reuses the SDK's bearer
	 * fetcher so callers don't have to wire auth themselves.
	 */
	stream(id: string, opts?: { signal?: AbortSignal }): AsyncGenerator<EvaluateStreamEvent, void, void>;
}

export interface EvaluateClient {
	listing(req: EvaluateRequest): Promise<EvaluateResponse>;
	pool(itemId: string): Promise<EvaluatePoolResponse>;
	jobs: EvaluateJobsClient;
}

export function createEvaluateClient(http: FlipagentHttp): EvaluateClient {
	return {
		listing: (req) => http.post("/v1/evaluate", req),
		pool: (itemId) => http.get(`/v1/evaluate/${encodeURIComponent(itemId)}/pool`),
		jobs: {
			create: (req) => http.post("/v1/evaluate/jobs", req),
			get: (id) => http.get(`/v1/evaluate/jobs/${encodeURIComponent(id)}`),
			cancel: (id) => http.post(`/v1/evaluate/jobs/${encodeURIComponent(id)}/cancel`, {}),
			stream: (id, opts) =>
				streamEvaluateJob({
					jobId: id,
					fetcher: (path, init) => http.fetchRaw(path, init),
					...(opts?.signal ? { signal: opts.signal } : {}),
				}),
		},
	};
}
