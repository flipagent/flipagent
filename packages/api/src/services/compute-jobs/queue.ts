/**
 * Compute-job queue. Pure DB ops + status transitions for the job rows
 * that back `/v1/evaluate/jobs/*` and `/v1/discover/jobs/*`. The actual
 * pipeline runner lives in `dispatcher.ts`; this file only writes state.
 *
 * Status machine (enforced in `transitionTo*`):
 *   queued ─► running ─► completed | failed | cancelled
 *   queued ─► cancelled  (cancel arrived before claim)
 *
 * Trace events are appended to a JSONB array as the worker emits them.
 * Late SSE subscribers replay the array, then receive live events via
 * the in-memory pub/sub below — no external broker needed since the
 * api runs as a single replica.
 */

import { EventEmitter } from "node:events";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type ComputeJob, computeJobs, type NewComputeJob } from "../../db/schema.js";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000; // 7d retention — long enough to come back the next morning

export const COMPUTE_JOB_TERMINAL: ReadonlySet<ComputeJob["status"]> = new Set(["completed", "failed", "cancelled"]);

export interface CreateComputeJobInput {
	apiKeyId: string;
	userId: string | null;
	kind: ComputeJob["kind"];
	params: Record<string, unknown>;
}

export async function createJob(input: CreateComputeJobInput): Promise<ComputeJob> {
	const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
	const insert: NewComputeJob = {
		apiKeyId: input.apiKeyId,
		userId: input.userId,
		kind: input.kind,
		params: input.params as object,
		expiresAt,
	};
	const [row] = await db.insert(computeJobs).values(insert).returning();
	if (!row) throw new Error("compute_jobs insert returned no row");
	return row;
}

export async function getJob(id: string, apiKeyId: string): Promise<ComputeJob | null> {
	const rows = await db
		.select()
		.from(computeJobs)
		.where(and(eq(computeJobs.id, id), eq(computeJobs.apiKeyId, apiKeyId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Mark a job's cancel flag. The worker checks this between steps and
 * throws cooperatively, which the dispatcher catches and transitions
 * to `cancelled`. If the job never made it past `queued`, transition
 * directly to `cancelled` here.
 */
export async function cancelJob(id: string, apiKeyId: string): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({ cancelRequested: true, updatedAt: now })
		.where(and(eq(computeJobs.id, id), eq(computeJobs.apiKeyId, apiKeyId)))
		.returning();
	if (!row) return null;
	// Worker hasn't picked it up yet — short-circuit terminal flip.
	if (row.status === "queued") {
		const [done] = await db
			.update(computeJobs)
			.set({ status: "cancelled", updatedAt: now, completedAt: now })
			.where(eq(computeJobs.id, id))
			.returning();
		return done ?? row;
	}
	return row;
}

export async function transitionToRunning(id: string): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({ status: "running", startedAt: now, updatedAt: now })
		.where(and(eq(computeJobs.id, id), eq(computeJobs.status, "queued")))
		.returning();
	return row ?? null;
}

export async function transitionToCompleted(id: string, result: unknown): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({ status: "completed", result: result as object, completedAt: now, updatedAt: now })
		.where(and(eq(computeJobs.id, id), eq(computeJobs.status, "running")))
		.returning();
	return row ?? null;
}

export async function transitionToFailed(
	id: string,
	errorCode: string,
	errorMessage: string,
): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({
			status: "failed",
			errorCode,
			errorMessage,
			completedAt: now,
			updatedAt: now,
		})
		.where(and(eq(computeJobs.id, id), eq(computeJobs.status, "running")))
		.returning();
	return row ?? null;
}

export async function transitionToCancelled(id: string): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({ status: "cancelled", completedAt: now, updatedAt: now })
		.where(eq(computeJobs.id, id))
		.returning();
	return row ?? null;
}

/**
 * Append a single trace event to the job's `trace` JSONB array. We use a
 * SQL-level append (`||`) instead of read-modify-write to avoid lost
 * updates if the worker emits steps in parallel (search.sold + search.active).
 */
export async function appendTrace(id: string, event: unknown): Promise<void> {
	await db
		.update(computeJobs)
		.set({
			trace: sql`${computeJobs.trace} || ${JSON.stringify([event])}::jsonb`,
			updatedAt: new Date(),
		})
		.where(eq(computeJobs.id, id));
}

export async function isCancelRequested(id: string): Promise<boolean> {
	const rows = await db
		.select({ cancelRequested: computeJobs.cancelRequested })
		.from(computeJobs)
		.where(eq(computeJobs.id, id))
		.limit(1);
	return rows[0]?.cancelRequested ?? false;
}

/**
 * Boot-time crash recovery — single api replica means any `running` rows
 * are stale (the worker that owned them is gone). Mark them failed so
 * the user sees a clear outcome instead of a row stuck on "Running"
 * forever.
 */
export async function failOrphans(): Promise<number> {
	const now = new Date();
	const result = await db
		.update(computeJobs)
		.set({
			status: "failed",
			errorCode: "worker_crashed",
			errorMessage: "api restarted while this job was running",
			completedAt: now,
			updatedAt: now,
		})
		.where(eq(computeJobs.status, "running"))
		.returning({ id: computeJobs.id });
	return result.length;
}

/* ---------------------- live in-memory pub/sub ---------------------- */
/**
 * Workers emit step events here so any active SSE subscribers can
 * forward them to clients in real time. Pure in-memory — single api
 * replica means there's no need for a Redis pub/sub. Subscribers that
 * arrive after a step has fired catch up by reading `trace` from the DB
 * before subscribing.
 */
const liveBus = new EventEmitter();
liveBus.setMaxListeners(0);

export type LiveEvent =
	| { kind: "step"; event: unknown }
	| {
			kind: "terminal";
			status: "completed" | "failed" | "cancelled";
			result?: unknown;
			errorCode?: string;
			errorMessage?: string;
	  };

export function publishLive(jobId: string, event: LiveEvent): void {
	liveBus.emit(jobId, event);
}

export function subscribeLive(jobId: string, listener: (event: LiveEvent) => void): () => void {
	liveBus.on(jobId, listener);
	return () => {
		liveBus.off(jobId, listener);
	};
}
