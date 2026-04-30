/**
 * `/v1/discover/*` — query-driven deal ranking.
 *
 * Five surfaces — one sync convenience + four queue-backed (mirrors
 * `/v1/evaluate/*`):
 *
 *   POST /v1/discover                       — sync mode
 *   POST /v1/discover/jobs                  — async create
 *   GET  /v1/discover/jobs/{id}             — poll
 *   GET  /v1/discover/jobs/{id}/stream      — SSE replay + live
 *   POST /v1/discover/jobs/{id}/cancel      — cooperative cancel
 *
 * Backed by `runDiscoverPipeline` and the shared compute-jobs queue.
 */

import { ComputeJobAck, DiscoverJob, DiscoverRequest, DiscoverResponse } from "@flipagent/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import type { ComputeJob } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { dispatch } from "../../services/compute-jobs/dispatcher.js";
import { httpStatusForPipelineError } from "../../services/compute-jobs/error-mapping.js";
import { cancelJob, createJob, getJob } from "../../services/compute-jobs/queue.js";
import { streamComputeJobEvents } from "../../services/compute-jobs/sse-stream.js";
import { runDiscoverPipeline } from "../../services/evaluate/run-discover.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const discoverRoute = new Hono();

discoverRoute.post(
	"/",
	describeRoute({
		tags: ["Discover"],
		summary: "Find deals matching a query (sync)",
		description:
			"Composite: active Browse search → cluster by product (epid → gtin → singleton, deterministic) → per-cluster narrow sold + active searches + LLM same-product filter (triage + decision-cache + verify) + scoring → rank by `recommendedExit.dollarsPerDay`. Returns the full `DiscoverResponse` once the pipeline reaches a terminal state. For a streaming view of each step, use `POST /v1/discover/jobs` then `GET /v1/discover/jobs/{id}/stream`. Internally creates a compute_job and awaits terminal — same code path as the async surface.\n\n**`deals[]` is NOT pre-filtered.** The array carries every active candidate that survived the matcher, sorted by `evaluation.recommendedExit.dollarsPerDay` desc, with nullish exits at the bottom. Items in narrow clusters (n<4 sold) get market median + `nObservations` but no `recommendedExit` — they still surface so the UI can render market context. Strict callers cut to `recommendedExit?.netCents > 0`; the SDK ships `isBuyable(deal)` for that.",
		responses: {
			200: jsonResponse("Ranked deals plus search meta.", DiscoverResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			422: errorResponse("Search returned too few candidates or sold matches."),
			429: errorResponse("Rate limit exceeded."),
			502: errorResponse("Upstream eBay failure."),
			503: errorResponse("eBay or scraper not configured."),
		},
	}),
	requireApiKey,
	tbBody(DiscoverRequest),
	async (c) => {
		const params = c.req.valid("json");
		const apiKey = c.var.apiKey;
		const job = await createJob({
			apiKeyId: apiKey.id,
			userId: apiKey.userId,
			kind: "discover",
			params: params as unknown as Record<string, unknown>,
		});
		const final = await dispatch({
			jobId: job.id,
			run: (onStep, cancelCheck) =>
				runDiscoverPipeline({
					q: params.q,
					categoryId: params.categoryId,
					filter: params.filter,
					limit: params.limit,
					lookbackDays: params.lookbackDays,
					soldLimit: params.soldLimit,
					apiKey,
					opts: params.opts,
					onStep: (event) => void onStep(event),
					cancelCheck,
				}),
		});
		if (!final) return c.json({ error: "internal", message: "job dispatch produced no row" }, 500);
		if (final.status === "completed") return c.json(final.result as unknown);
		if (final.status === "cancelled") {
			return c.json({ error: "cancelled", message: "job was cancelled before completion" }, 409);
		}
		const code = final.errorCode ?? "internal";
		const message = final.errorMessage ?? "discover failed";
		return c.json({ error: code, message }, httpStatusForPipelineError(code));
	},
);

discoverRoute.post(
	"/jobs",
	describeRoute({
		tags: ["Discover"],
		summary: "Create a discover job (async)",
		description:
			'Creates a compute job, returns `{ id, status: "queued" }` immediately. Caller polls `GET /v1/discover/jobs/{id}` or subscribes to `/jobs/{id}/stream`. Survives client disconnect — closing the tab mid-run does not abort the pipeline.',
		responses: {
			202: jsonResponse("Job queued.", ComputeJobAck),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbBody(DiscoverRequest),
	async (c) => {
		const params = c.req.valid("json");
		const apiKey = c.var.apiKey;
		const job = await createJob({
			apiKeyId: apiKey.id,
			userId: apiKey.userId,
			kind: "discover",
			params: params as unknown as Record<string, unknown>,
		});
		void dispatch({
			jobId: job.id,
			run: (onStep, cancelCheck) =>
				runDiscoverPipeline({
					q: params.q,
					categoryId: params.categoryId,
					filter: params.filter,
					limit: params.limit,
					lookbackDays: params.lookbackDays,
					soldLimit: params.soldLimit,
					apiKey,
					opts: params.opts,
					onStep: (event) => void onStep(event),
					cancelCheck,
				}),
		});
		return c.json({ id: job.id, status: job.status }, 202);
	},
);

discoverRoute.get(
	"/jobs/:id",
	describeRoute({
		tags: ["Discover"],
		summary: "Get current state + result (when complete) for a discover job",
		description: "Returns the full job row — `status`, `params`, `result`. 7-day retention; older rows return 404.",
		responses: {
			200: jsonResponse("Job state.", DiscoverJob),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Job not found or expired."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const job = await getJob(id, c.var.apiKey.id);
		if (!job || job.kind !== "discover") {
			return c.json({ error: "not_found", message: `No discover job ${id} for this api key.` }, 404);
		}
		return c.json(toDiscoverJobShape(job));
	},
);

discoverRoute.get(
	"/jobs/:id/stream",
	describeRoute({
		tags: ["Discover"],
		summary: "Live SSE stream of trace events for a discover job",
		description:
			"Replays accumulated step events from `trace`, then live-streams new events as the worker emits them, ending with a terminal `done` / `cancelled` / `error`. Reconnect-safe — a tab that reloaded mid-run can pick up where it left off.",
		responses: {
			200: { description: "SSE stream of step events." },
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Job not found or expired."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const job = await getJob(id, c.var.apiKey.id);
		if (!job || job.kind !== "discover") {
			return c.json({ error: "not_found", message: `No discover job ${id} for this api key.` }, 404);
		}
		return streamSSE(c, (stream) => streamComputeJobEvents(c, stream, job));
	},
);

discoverRoute.post(
	"/jobs/:id/cancel",
	describeRoute({
		tags: ["Discover"],
		summary: "Request cooperative cancel for a discover job",
		description: "Sets `cancel_requested = true`. Worker tears down at the next step boundary. Idempotent.",
		responses: {
			200: jsonResponse("Cancel acknowledged.", ComputeJobAck),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Job not found or expired."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const job = await cancelJob(id, c.var.apiKey.id);
		if (!job || job.kind !== "discover") {
			return c.json({ error: "not_found", message: `No discover job ${id} for this api key.` }, 404);
		}
		return c.json({ id: job.id, status: job.status });
	},
);

function toDiscoverJobShape(job: ComputeJob): DiscoverJob {
	return {
		id: job.id,
		kind: "discover",
		status: job.status,
		params: job.params as DiscoverJob["params"],
		result: (job.result as DiscoverJob["result"]) ?? null,
		errorCode: job.errorCode ?? null,
		errorMessage: job.errorMessage ?? null,
		cancelRequested: job.cancelRequested,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		completedAt: job.completedAt?.toISOString() ?? null,
		expiresAt: job.expiresAt.toISOString(),
	};
}

