/**
 * Shared shapes for the server-side compute-job queue (`/v1/evaluate/jobs/*`).
 * Per-pipeline job shapes (`EvaluateJob`) live next to their request/response
 * counterparts in `evaluate.ts`; this file only carries the common status
 * enum + the trace-replay primitives a /stream subscriber sees.
 */

import { type Static, Type } from "@sinclair/typebox";

/**
 * Lifecycle of a compute job. Mirrors `compute_job_status` in the DB.
 *
 *   queued     — created, worker hasn't picked it up
 *   running    — worker started, pipeline is executing
 *   completed  — pipeline finished, `result` is set
 *   failed     — pipeline threw; `errorCode` + `errorMessage` are set
 *   cancelled  — user called the cancel endpoint; cooperative — the
 *                worker tears down at the next step boundary
 */
export const ComputeJobStatus = Type.Union(
	[
		Type.Literal("queued"),
		Type.Literal("running"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("cancelled"),
	],
	{ $id: "ComputeJobStatus" },
);
export type ComputeJobStatus = Static<typeof ComputeJobStatus>;

/** Kind discriminator on the job row — same name as the pipeline that backs it. */
export const ComputeJobKind = Type.Union([Type.Literal("evaluate"), Type.Literal("search")], {
	$id: "ComputeJobKind",
});
export type ComputeJobKind = Static<typeof ComputeJobKind>;

/**
 * Common job-row fields. Per-pipeline jobs extend this with their own
 * `params` / `result` shapes via `Type.Intersect`.
 */
export const ComputeJobBase = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		kind: ComputeJobKind,
		status: ComputeJobStatus,
		errorCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		errorMessage: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		/**
		 * Structured payload attached by the failing pipeline step.
		 * `variation_required` ships `{legacyId, variations[]}` so an
		 * agent can pick a SKU and retry without a second round-trip.
		 * Shape is pipeline-specific; treat as opaque and forward
		 * verbatim. Null/absent on success and on errors that don't
		 * carry structured details (most don't).
		 */
		errorDetails: Type.Optional(Type.Union([Type.Unknown(), Type.Null()])),
		cancelRequested: Type.Boolean(),
		createdAt: Type.String({ format: "date-time" }),
		startedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		completedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "ComputeJobBase" },
);
export type ComputeJobBase = Static<typeof ComputeJobBase>;

/**
 * Empty 202-style ack returned by `POST /v1/evaluate/jobs` and
 * `POST /v1/evaluate/jobs/{id}/cancel`. The full job shape is fetched via
 * `GET /jobs/{id}` or streamed via `GET /jobs/{id}/stream`.
 */
export const ComputeJobAck = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		status: ComputeJobStatus,
	},
	{ $id: "ComputeJobAck" },
);
export type ComputeJobAck = Static<typeof ComputeJobAck>;

/**
 * Lean row shape for `GET /v1/jobs` — the cross-surface, cross-kind
 * activity history. Each surface (extension, playground, MCP, agent,
 * SDK) writes to the same `compute_jobs` rows regardless of `kind`,
 * so this list reflects everything the api-key has done in one place.
 *
 * `label` / `subLabel` are pre-rendered for the UI:
 *   - evaluate → label = listing title (or itemId if title missing),
 *                subLabel = `evaluation.rating` (`buy` / `hold` / `skip`)
 *   - search   → label = `q` or category id, subLabel = `${count} results`
 *
 * Click-through hits `GET /v1/jobs/{id}` (TODO) or per-kind get
 * (`GET /v1/evaluate/jobs/{id}` for full evaluate result).
 */
export const JobSummary = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		kind: ComputeJobKind,
		status: ComputeJobStatus,
		label: Type.String(),
		subLabel: Type.Optional(Type.String()),
		imageUrl: Type.Optional(Type.String({ format: "uri" })),
		/**
		 * Original request params — kind-specific shape. Embedded in the
		 * summary so a one-click re-run from history doesn't need a second
		 * round-trip to fetch the inputs. Small (few KB max); cheap.
		 */
		params: Type.Unknown(),
		errorCode: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		completedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "JobSummary" },
);
export type JobSummary = Static<typeof JobSummary>;

/**
 * `GET /v1/jobs` body. `cursor` is the ISO timestamp of the last row's
 * `createdAt` — pass back as `?cursor=` to fetch the next page. Null
 * when no more rows.
 */
export const JobListResponse = Type.Object(
	{
		items: Type.Array(JobSummary),
		cursor: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "JobListResponse" },
);
export type JobListResponse = Static<typeof JobListResponse>;
