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
export const ComputeJobKind = Type.Union([Type.Literal("evaluate")], {
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
