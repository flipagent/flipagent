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

import {
	ComputeJobAck,
	EvaluateJob,
	EvaluatePoolResponse,
	EvaluateRequest,
	EvaluateResponse,
	FeaturedEvaluationsResponse,
} from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { type ComputeJob, computeJobs } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { httpStatusForPipelineError } from "../../services/compute-jobs/error-mapping.js";
import {
	awaitTerminal,
	cancelJob,
	createJob,
	findInProgressEvaluateJob,
	getJob,
} from "../../services/compute-jobs/queue.js";
import { streamComputeJobEvents } from "../../services/compute-jobs/sse-stream.js";
import { buildPoolResponse } from "../../services/evaluate/digest.js";
import { listFeaturedEvaluations } from "../../services/evaluate/featured.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const evaluateRoute = new Hono();

/**
 * Resolve the compute job for an evaluate request. If an in-progress
 * job already exists for `(apiKey, itemId)` we return it instead of
 * creating a new row — the second client (e.g. the Chrome extension
 * after the dashboard playground) attaches to the same job's stream
 * and sees the same trace, instead of paying for a duplicate run.
 *
 * Race window: two simultaneous POSTs that both miss the lookup will
 * each insert. Worst case is one extra run; the result cache dedups
 * the user-visible outcome on subsequent reads.
 */
async function startOrAttachEvaluateJob(
	apiKey: { id: string; userId: string | null },
	params: { itemId: string } & Record<string, unknown>,
): Promise<{ job: import("../../db/schema.js").ComputeJob; reused: boolean }> {
	const existing = await findInProgressEvaluateJob(apiKey.id, params.itemId);
	if (existing) return { job: existing, reused: true };
	const job = await createJob({
		apiKeyId: apiKey.id,
		userId: apiKey.userId,
		kind: "evaluate",
		params,
	});
	return { job, reused: false };
}

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
		const { job } = await startOrAttachEvaluateJob(
			apiKey,
			params as unknown as { itemId: string } & Record<string, unknown>,
		);
		// Worker container claims and runs the pipeline; this route waits
		// for the row to reach terminal status. Abort signal stops the
		// poll loop early when the client disconnects (no point holding
		// a DB connection open for a vanished caller).
		const final = await awaitTerminal(job.id, apiKey.id, {
			timeoutMs: SYNC_EVALUATE_TIMEOUT_MS,
			signal: c.req.raw.signal,
		});
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
		const errorBody: Record<string, unknown> = { error: code, message };
		// `variation_required` (and any future typed error that adopts
		// `EvaluateError.details`) ships a structured payload alongside the
		// human-readable code+message. Surface it so an agent can read
		// `details.variations[]` and retry with a specific variationId.
		if (final.errorDetails != null) errorBody.details = final.errorDetails;
		return c.json(errorBody, httpStatusForPipelineError(code));
	},
);

/* ------------------------------- drill-down ------------------------------- */

/**
 * Companion to the digest returned by `POST /v1/evaluate`. Looks up
 * the most recent completed evaluate job for this api key + itemId and
 * returns the same-product pools (kept + rejected, with per-item
 * rejection reason inline). This is the playground-equivalent "View"
 * expansion.
 *
 * Cache-only — no compute. Returns 412 with `next_action` when no
 * recent evaluation is on file, instructing the caller to run
 * `POST /v1/evaluate` first. Cheap (single indexed DB read), so we
 * do **not** charge a usage event here.
 */
evaluateRoute.get(
	"/:itemId/pool",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Drill into the same-product pools used to score one listing",
		description:
			"Returns the kept + rejected sold/active listings the LLM filter selected, with per-item rejection reason inline. Mirrors the playground's per-section 'View' expansion. Cache-only — call POST /v1/evaluate first within the cache TTL; on cache miss returns 412 with a next_action pointer.",
		responses: {
			200: jsonResponse("Same-product pools.", EvaluatePoolResponse),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("No recent evaluation cached. Run POST /v1/evaluate first."),
		},
	}),
	requireApiKey,
	async (c) => {
		const itemId = c.req.param("itemId");
		const apiKey = c.var.apiKey;
		// Most recent completed evaluate job for this api key + itemId,
		// from the last 24h. Indexed on (apiKeyId, createdAt desc).
		const [row] = await db
			.select()
			.from(computeJobs)
			.where(
				and(
					eq(computeJobs.apiKeyId, apiKey.id),
					eq(computeJobs.kind, "evaluate"),
					eq(computeJobs.status, "completed"),
					sql`${computeJobs.params}->>'itemId' = ${itemId}`,
				),
			)
			.orderBy(desc(computeJobs.completedAt))
			.limit(1);
		if (!row || !row.result) {
			return c.json(
				{
					error: "no_cached_evaluation",
					message: `No completed evaluation found for itemId=${itemId}. Run POST /v1/evaluate first.`,
					next_action: {
						kind: "run_evaluate_first",
						url: `${new URL(c.req.url).origin}/v1/evaluate`,
						instructions:
							"Call POST /v1/evaluate with this itemId first; once complete, re-call this endpoint within ~24h to drill into the same-product pools.",
					},
				},
				412,
			);
		}
		const result = row.result as {
			soldPool?: ItemSummary[];
			activePool?: ItemSummary[];
			rejectedSoldPool?: ItemSummary[];
			rejectedActivePool?: ItemSummary[];
			rejectionReasons?: Record<string, string>;
			rejectionCategories?: Record<string, string>;
		};
		const body = buildPoolResponse({
			itemId,
			evaluatedAt: row.completedAt?.toISOString() ?? new Date().toISOString(),
			soldKept: result.soldPool ?? [],
			soldRejected: result.rejectedSoldPool ?? [],
			activeKept: result.activePool ?? [],
			activeRejected: result.rejectedActivePool ?? [],
			rejectionReasons: result.rejectionReasons ?? {},
			rejectionCategories: result.rejectionCategories ?? {},
		});
		// Suppress the unused-helper warning for `nextAction` — it's already
		// imported by sibling routes; keep the import grouped here for the
		// 503 path if billing/eBay env is missing in the future.
		void nextAction;
		return c.json(body);
	},
);

/* ----------------------------- featured ----------------------------- */

evaluateRoute.get(
	"/featured",
	describeRoute({
		tags: ["Evaluate"],
		summary: "List recently-evaluated listings as showcase examples",
		description:
			"Server-curated \"Try one\" pool. Returns up to `limit` recent successful evaluate jobs (any caller, last 14 days, sold-pool ≥ 8) deduped by itemId, with takedown'd items excluded. Click-through hits the cached evaluate result so demo runs do not re-spend credits. Powers the playground's preset chips.",
		responses: {
			200: jsonResponse("Featured evaluation examples.", FeaturedEvaluationsResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const limitRaw = Number.parseInt(c.req.query("limit") ?? "", 10);
		const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
		const items = await listFeaturedEvaluations({ limit });
		return c.json({ items });
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
		const { job } = await startOrAttachEvaluateJob(
			apiKey,
			params as unknown as { itemId: string } & Record<string, unknown>,
		);
		// The worker container picks the row up via `claimNextJob`. A
		// /stream subscriber (or /jobs/{id} poll) sees the same progress
		// regardless of when it connects. Idempotent — if another client
		// already kicked off this itemId, both surfaces converge here.
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

/* ----------------------------- discover active ----------------------------- */

/**
 * Cross-surface live-state probe. Returns the in-progress evaluate
 * job for `(apiKey, itemId)` if one exists — the playground started
 * a run, the extension chip mounts on `/itm/X`, this lets the chip
 * attach to the same job and stream the same trace instead of
 * showing a disconnected "idle" state.
 *
 * Returns 200 with `{ id, status }` when found, 200 with `null` when
 * not. Cheap enough for the chip to call on every mount.
 */
evaluateRoute.get(
	"/active",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Find the in-progress evaluate job for an itemId, if any",
		description:
			"Returns the active (queued or running) evaluate job for `(apiKey, itemId)`. Used by clients to attach to a job started by another surface (e.g. the extension chip auto-syncs with a playground run). Returns `null` when no active job exists.",
		responses: {
			200: { description: "Active job or null." },
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const itemId = c.req.query("itemId");
		if (!itemId) return c.json({ error: "itemId_required" }, 400);
		const job = await findInProgressEvaluateJob(c.var.apiKey.id, itemId);
		return c.json(job ? { id: job.id, status: job.status } : null);
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
		errorDetails: job.errorDetails ?? null,
		cancelRequested: job.cancelRequested,
		createdAt: job.createdAt.toISOString(),
		startedAt: job.startedAt?.toISOString() ?? null,
		completedAt: job.completedAt?.toISOString() ?? null,
		expiresAt: job.expiresAt.toISOString(),
	};
}
