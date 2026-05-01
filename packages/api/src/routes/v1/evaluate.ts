/**
 * `/v1/evaluate/*` — id-driven listing judgment.
 *
 * Five surfaces — one sync convenience + four queue-backed:
 *
 *   POST /v1/evaluate                       — sync mode. Creates a compute
 *                                             job, awaits terminal status,
 *                                             returns the final result. MCP
 *                                             / SDK / agents that want a
 *                                             one-shot call land here.
 *   POST /v1/evaluate/jobs                  — async mode. Creates the job
 *                                             and returns `{ id, status }`
 *                                             immediately. Caller polls
 *                                             /jobs/{id} or subscribes to
 *                                             /jobs/{id}/stream.
 *   GET  /v1/evaluate/jobs/{id}             — poll status + result.
 *   GET  /v1/evaluate/jobs/{id}/stream      — SSE: replay accumulated trace
 *                                             events, then live-stream
 *                                             until the job is terminal.
 *                                             Survives mid-run reload.
 *   POST /v1/evaluate/jobs/{id}/cancel      — request cancel. Worker tears
 *                                             down at the next step
 *                                             boundary.
 *
 * Maps to the Decisions pillar on the marketing site (#01).
 */

import { ComputeJobAck, EvaluateJob, EvaluateRequest, EvaluateResponse } from "@flipagent/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import type { ComputeJob } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { httpStatusForPipelineError } from "../../services/compute-jobs/error-mapping.js";
import { awaitTerminal, cancelJob, createJob, getJob } from "../../services/compute-jobs/queue.js";
import { streamComputeJobEvents } from "../../services/compute-jobs/sse-stream.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const evaluateRoute = new Hono();

/** Hard deadline for sync evaluate. Container Apps default ingress
 * idle timeout is ~240s; staying under that surfaces a clean
 * `evaluation_timeout` instead of a TCP reset. Discover's deadline
 * lives in its own route. */
const SYNC_EVALUATE_TIMEOUT_MS = 4 * 60_000;

/* ----------------------------- sync POST ----------------------------- */

evaluateRoute.post(
	"/",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Score a single listing as a flip opportunity (sync)",
		description:
			"Composite: server fetches the item detail, runs sold + active searches in parallel, LLM-filters to same-product, runs the evaluation. Returns `{ item, evaluation, meta, soldPool, activePool, rejectedSoldPool, rejectedActivePool, market }` once the pipeline reaches a terminal state. For a streaming view of each step, use `POST /v1/evaluate/jobs` then `GET /v1/evaluate/jobs/{id}/stream`. Internally this creates a compute_job and awaits terminal — same code path as the async surface, just collapsed for one-shot callers.",
		responses: {
			200: jsonResponse("Final evaluation + pools.", EvaluateResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Item not found."),
			422: errorResponse("Too few sold matches to evaluate."),
			429: errorResponse("Rate limit exceeded."),
			502: errorResponse("Upstream eBay failure."),
			503: errorResponse("eBay or scraper not configured."),
		},
	}),
	requireApiKey,
	tbBody(EvaluateRequest),
	async (c) => {
		const params = c.req.valid("json");
		const apiKey = c.var.apiKey;
		const job = await createJob({
			apiKeyId: apiKey.id,
			userId: apiKey.userId,
			kind: "evaluate",
			params: params as unknown as Record<string, unknown>,
		});
		// Worker container claims and runs the pipeline; this route waits
		// for the row to reach terminal status.
		const final = await awaitTerminal(job.id, apiKey.id, { timeoutMs: SYNC_EVALUATE_TIMEOUT_MS });
		if (!final) {
			return c.json(
				{
					error: "evaluation_timeout",
					message: `Job did not reach a terminal state within ${SYNC_EVALUATE_TIMEOUT_MS}ms. Use POST /v1/evaluate/jobs + /v1/evaluate/jobs/{id}/stream for long-running runs.`,
					jobId: job.id,
				},
				504,
			);
		}
		if (final.status === "completed") return c.json(final.result as unknown);
		if (final.status === "cancelled") {
			return c.json({ error: "cancelled", message: "job was cancelled before completion" }, 409);
		}
		// failed
		const code = final.errorCode ?? "internal";
		const message = final.errorMessage ?? "evaluation failed";
		return c.json({ error: code, message }, httpStatusForPipelineError(code));
	},
);

/* ----------------------------- async create ----------------------------- */

evaluateRoute.post(
	"/jobs",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Create an evaluate job (async — returns immediately)",
		description:
			'Creates a compute job, returns `{ id, status: "queued" }` immediately. Caller polls `GET /v1/evaluate/jobs/{id}` or subscribes to `GET /v1/evaluate/jobs/{id}/stream` for live trace events. Survives client disconnect — closing the tab mid-run does not abort the pipeline.',
		responses: {
			202: jsonResponse("Job queued.", ComputeJobAck),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbBody(EvaluateRequest),
	async (c) => {
		const params = c.req.valid("json");
		const apiKey = c.var.apiKey;
		const job = await createJob({
			apiKeyId: apiKey.id,
			userId: apiKey.userId,
			kind: "evaluate",
			params: params as unknown as Record<string, unknown>,
		});
		// The worker container picks the row up via `claimNextJob`. A
		// /stream subscriber (or /jobs/{id} poll) sees the same progress
		// regardless of when it connects.
		return c.json({ id: job.id, status: job.status }, 202);
	},
);

/* ----------------------------- async poll ----------------------------- */

evaluateRoute.get(
	"/jobs/:id",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Get current state + result (when complete) for an evaluate job",
		description:
			'Returns the full job row — `status`, `params`, and `result` (set iff `status === "completed"`). 7-day retention; older rows return 404. Polling cadence at the caller\'s discretion (1-2s is fine; the worker writes intermediate trace events to the `trace` column visible via /stream, not here).',
		responses: {
			200: jsonResponse("Job state.", EvaluateJob),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Job not found or expired."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const job = await getJob(id, c.var.apiKey.id);
		if (!job || job.kind !== "evaluate") {
			return c.json({ error: "not_found", message: `No evaluate job ${id} for this api key.` }, 404);
		}
		return c.json(toEvaluateJobShape(job));
	},
);

/* ----------------------------- async stream ----------------------------- */

evaluateRoute.get(
	"/jobs/:id/stream",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Live SSE stream of trace events for an evaluate job",
		description:
			"Replays accumulated step events from the job's `trace` column, then live-streams new events as the worker emits them, ending with a terminal `done` / `cancelled` / `error` event. Reconnect-safe: closing and reopening the stream replays the trace from the start and resumes live, so a tab that reloaded mid-run picks up exactly where it left off.",
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
		if (!job || job.kind !== "evaluate") {
			return c.json({ error: "not_found", message: `No evaluate job ${id} for this api key.` }, 404);
		}
		return streamSSE(c, (stream) => streamComputeJobEvents(c, stream, job));
	},
);

/* ----------------------------- async cancel ----------------------------- */

evaluateRoute.post(
	"/jobs/:id/cancel",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Request cooperative cancel for an evaluate job",
		description:
			'Sets `cancel_requested = true` on the row. The worker checks this between pipeline steps and tears down at the next boundary, transitioning to `status: "cancelled"`. Mid-step IO (eBay scrape, LLM call) cannot be aborted but step boundaries are tight (≤ a few seconds each). Idempotent — calling cancel on a terminal job returns the current state unchanged.',
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
		if (!job || job.kind !== "evaluate") {
			return c.json({ error: "not_found", message: `No evaluate job ${id} for this api key.` }, 404);
		}
		return c.json({ id: job.id, status: job.status });
	},
);

/* ----------------------------- helpers ----------------------------- */

function toEvaluateJobShape(job: ComputeJob): EvaluateJob {
	return {
		id: job.id,
		kind: "evaluate",
		status: job.status,
		params: job.params as EvaluateJob["params"],
		result: (job.result as EvaluateJob["result"]) ?? null,
		errorCode: job.errorCode ?? null,
		errorMessage: job.errorMessage ?? null,
		cancelRequested: job.cancelRequested,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		completedAt: job.completedAt?.toISOString() ?? null,
		expiresAt: job.expiresAt.toISOString(),
	};
}
