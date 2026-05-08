/**
 * `client.evaluate.*` — Product/listing intelligence over HTTP. Pass a
 * `ProductRef` (id / external listing / free-text query) and the server
 * resolves to a flipagent Product, runs the cross-marketplace MarketView
 * pipeline, and — when the ref carries a specific listing — lays the
 * buy-decision overlay on top.
 *
 *   `evaluation: null`  → "what's this product worth"
 *   `evaluation: {…}`   → "should I buy this listing"
 *
 * Math runs server-side so all language SDKs return identical numbers.
 *
 * Three surfaces:
 *   .run(req)            — sync. Awaits the full pipeline and returns
 *                          `EvaluateResponse`. Right call for one-shot
 *                          agents and notebooks.
 *   .pool(itemId)        — drill-down companion (listing-mode runs
 *                          only). Returns `EvaluatePoolResponse` (kept
 *                          + rejected listings with per-item reason).
 *                          Cache-only; requires a recent `.run()` call
 *                          within the cache TTL or it 412s.
 *   .jobs.create/get/cancel/stream — async. Job lives 7d, survives
 *                          client disconnect, supports cooperative
 *                          cancel + live SSE.
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
	run(req: EvaluateRequest): Promise<EvaluateResponse>;
	pool(itemId: string): Promise<EvaluatePoolResponse>;
	jobs: EvaluateJobsClient;
}

export function createEvaluateClient(http: FlipagentHttp): EvaluateClient {
	return {
		run: (req) => http.post("/v1/evaluate", req),
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
