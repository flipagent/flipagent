/**
 * `client.evaluate.*` — id-driven single-listing judgment. flipagent's
 * Decisions pillar over HTTP. Pass an `itemId` and the server fetches
 * the detail, derives sold + active matched listings, and returns the
 * evaluation plus a `meta` block describing what was fetched. Math runs
 * server-side so all language SDKs return identical evaluations.
 *
 * Two surfaces:
 *   .listing(req)        — sync. Awaits the full pipeline and returns
 *                          `EvaluateResponse`. Right call for one-shot
 *                          agents and notebooks.
 *   .jobs.create/get/cancel — async. Job lives 7d, survives client
 *                          disconnect, supports cooperative cancel.
 *                          Right call when you want a UI that streams
 *                          progress or a backgrounded task.
 */

import type { ComputeJobAck, EvaluateJob, EvaluateRequest, EvaluateResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface EvaluateJobsClient {
	create(req: EvaluateRequest): Promise<ComputeJobAck>;
	get(id: string): Promise<EvaluateJob>;
	cancel(id: string): Promise<ComputeJobAck>;
}

export interface EvaluateClient {
	listing(req: EvaluateRequest): Promise<EvaluateResponse>;
	jobs: EvaluateJobsClient;
}

export function createEvaluateClient(http: FlipagentHttp): EvaluateClient {
	return {
		listing: (req) => http.post("/v1/evaluate", req),
		jobs: {
			create: (req) => http.post("/v1/evaluate/jobs", req),
			get: (id) => http.get(`/v1/evaluate/jobs/${encodeURIComponent(id)}`),
			cancel: (id) => http.post(`/v1/evaluate/jobs/${encodeURIComponent(id)}/cancel`, {}),
		},
	};
}
