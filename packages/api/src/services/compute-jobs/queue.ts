/**
 * Compute-job queue. Pure DB ops + lease-based claim/heartbeat for the
 * job rows that back `/v1/evaluate/jobs/*`. The actual pipeline runner
 * lives in `dispatcher.ts`; this file only writes state.
 *
 * Status machine:
 *   queued ─► running ─► completed | failed | cancelled
 *   queued ─► cancelled  (cancel arrived before claim)
 *   running (lease expired) ─► queued | failed  (recovery sweep)
 *
 * Concurrency model: the API container `INSERT`s jobs and never runs
 * them; a separate worker container `claimNextJob` atomically and runs
 * the dispatcher. Each claim sets `lease_until = now() + leaseMs`; the
 * worker heartbeats `renewLease` every WORKER_HEARTBEAT_MS so lease
 * never expires under normal operation. On crash / OOM / SIGKILL the
 * lease falls in the past and `recoverExpiredLeases` either requeues
 * (if `attempts < max`) or fails the row with `worker_lease_expired`.
 *
 * Trace events are appended to a JSONB array as the worker emits them.
 * SSE subscribers in the API container poll `compute_jobs.trace` +
 * `status` to forward live progress — see `sse-stream.ts`.
 */

import { and, asc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
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
			.set({
				status: "cancelled",
				completedAt: now,
				updatedAt: now,
				leaseUntil: null,
				claimedBy: null,
			})
			.where(eq(computeJobs.id, id))
			.returning();
		return done ?? row;
	}
	return row;
}

export interface ClaimInput {
	/** Stable identifier for this worker process (e.g. `worker-<host>-<pid>`). */
	workerId: string;
	/** Lease duration in ms. Worker must `renewLease` before this elapses. */
	leaseMs: number;
}

/**
 * Atomically claim the oldest claimable job. A row is claimable when
 * `cancel_requested = false` AND (`status='queued'` OR an expired
 * lease — the previous worker died). Sets `status='running'`,
 * `lease_until=now()+leaseMs`, increments `attempts`, and stamps
 * `claimed_by` so subsequent transitions can verify ownership.
 *
 * `FOR UPDATE SKIP LOCKED` means concurrent workers polling the same
 * table never collide on the same row — at most one worker observes
 * each candidate. Returns null when nothing's claimable.
 */
export async function claimNextJob({ workerId, leaseMs }: ClaimInput): Promise<ComputeJob | null> {
	const now = new Date();
	const leaseUntil = new Date(Date.now() + leaseMs);
	return await db.transaction(async (tx) => {
		const candidates = await tx
			.select({ id: computeJobs.id })
			.from(computeJobs)
			.where(
				and(
					eq(computeJobs.cancelRequested, false),
					or(
						eq(computeJobs.status, "queued"),
						and(eq(computeJobs.status, "running"), lt(computeJobs.leaseUntil, now)),
					),
				),
			)
			.orderBy(asc(computeJobs.createdAt))
			.limit(1)
			.for("update", { skipLocked: true });
		const id = candidates[0]?.id;
		if (!id) return null;
		const [row] = await tx
			.update(computeJobs)
			.set({
				status: "running",
				leaseUntil,
				claimedBy: workerId,
				attempts: sql`${computeJobs.attempts} + 1`,
				startedAt: sql`coalesce(${computeJobs.startedAt}, now())`,
				updatedAt: now,
			})
			.where(eq(computeJobs.id, id))
			.returning();
		return row ?? null;
	});
}

/**
 * Heartbeat from the worker — extends the lease deadline. Only the
 * current `claimed_by` may renew; if the row was already taken over by
 * another worker (lease had expired and the recovery sweep handed it
 * off), this returns null and the caller should abort the run to avoid
 * double-execution.
 */
export async function renewLease(id: string, workerId: string, leaseMs: number): Promise<ComputeJob | null> {
	const leaseUntil = new Date(Date.now() + leaseMs);
	const [row] = await db
		.update(computeJobs)
		.set({ leaseUntil, updatedAt: new Date() })
		.where(and(eq(computeJobs.id, id), eq(computeJobs.claimedBy, workerId), eq(computeJobs.status, "running")))
		.returning();
	return row ?? null;
}

/**
 * Voluntarily release a claim — used on graceful shutdown so another
 * worker (or this one after restart) can re-claim immediately instead
 * of waiting for `lease_until` to elapse. Drops the row back to
 * `queued`. Only the current `claimed_by` may release.
 */
export async function releaseLease(id: string, workerId: string): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({ status: "queued", leaseUntil: null, claimedBy: null, updatedAt: now })
		.where(and(eq(computeJobs.id, id), eq(computeJobs.claimedBy, workerId), eq(computeJobs.status, "running")))
		.returning();
	return row ?? null;
}

export async function transitionToCompleted(id: string, workerId: string, result: unknown): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({
			status: "completed",
			result: result as object,
			completedAt: now,
			updatedAt: now,
			leaseUntil: null,
			claimedBy: null,
		})
		.where(and(eq(computeJobs.id, id), eq(computeJobs.claimedBy, workerId), eq(computeJobs.status, "running")))
		.returning();
	return row ?? null;
}

export async function transitionToFailed(
	id: string,
	workerId: string,
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
			leaseUntil: null,
			claimedBy: null,
		})
		.where(and(eq(computeJobs.id, id), eq(computeJobs.claimedBy, workerId), eq(computeJobs.status, "running")))
		.returning();
	return row ?? null;
}

export async function transitionToCancelled(id: string, workerId: string): Promise<ComputeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(computeJobs)
		.set({
			status: "cancelled",
			completedAt: now,
			updatedAt: now,
			leaseUntil: null,
			claimedBy: null,
		})
		.where(and(eq(computeJobs.id, id), eq(computeJobs.claimedBy, workerId), eq(computeJobs.status, "running")))
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

export interface AwaitTerminalOpts {
	/** Hard deadline in ms; resolves null if not terminal by then. */
	timeoutMs: number;
	/** Poll interval in ms. */
	intervalMs?: number;
	/**
	 * Abort signal — when the caller (HTTP request) goes away, stop
	 * polling immediately instead of running the full deadline. Resolves
	 * null when aborted. Routes pass `c.req.raw.signal` here.
	 */
	signal?: AbortSignal;
}

/** Sleep that resolves early on abort. */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		if (!signal) return;
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Poll `getJob` until status is terminal or `timeoutMs` elapses. Used
 * by the sync `POST /v1/evaluate` route after enqueueing — the API
 * container doesn't run pipelines, so it observes the worker's outcome
 * through this helper. Returns the terminal row, or null on timeout /
 * abort / row vanished.
 *
 * `getJob` throws (DB blip) are absorbed: log, briefly back off, then
 * resume polling. The job state lives in the row, not in this loop —
 * a dropped poll cycle just delays the response, never loses progress.
 */
export async function awaitTerminal(
	id: string,
	apiKeyId: string,
	{ timeoutMs, intervalMs = 500, signal }: AwaitTerminalOpts,
): Promise<ComputeJob | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (signal?.aborted) return null;
		let row: ComputeJob | null = null;
		try {
			row = await getJob(id, apiKeyId);
		} catch (err) {
			console.error(`[awaitTerminal] getJob ${id} failed:`, err);
			// Back off 2× the normal interval on a DB blip — gives the
			// pool a chance to recover before we hammer it again.
			await sleepWithAbort(intervalMs * 2, signal);
			continue;
		}
		if (!row) return null;
		if (COMPUTE_JOB_TERMINAL.has(row.status)) return row;
		const remaining = deadline - Date.now();
		if (remaining <= 0) return null;
		await sleepWithAbort(Math.min(intervalMs, remaining), signal);
	}
	return null;
}

export interface RecoveryResult {
	requeued: number;
	failed: number;
}

/**
 * Recovery sweep — find rows whose lease has fallen in the past while
 * still `running` (worker died without releasing). If the job has more
 * attempts left, drop it back to `queued` so the next `claimNextJob`
 * picks it up. Otherwise mark it `failed` with code
 * `worker_lease_expired` so the user sees a clear outcome instead of
 * a row stuck on "Running" forever.
 *
 * Idempotent and safe to run on every worker boot AND on a periodic
 * tick. SKIP LOCKED protects against two workers sweeping the same
 * row in parallel.
 */
export async function recoverExpiredLeases({ maxAttempts }: { maxAttempts: number }): Promise<RecoveryResult> {
	const now = new Date();
	return await db.transaction(async (tx) => {
		const expired = await tx
			.select({ id: computeJobs.id, attempts: computeJobs.attempts })
			.from(computeJobs)
			.where(
				and(eq(computeJobs.status, "running"), isNotNull(computeJobs.leaseUntil), lt(computeJobs.leaseUntil, now)),
			)
			.for("update", { skipLocked: true });
		let requeued = 0;
		let failed = 0;
		for (const row of expired) {
			if (row.attempts < maxAttempts) {
				await tx
					.update(computeJobs)
					.set({ status: "queued", leaseUntil: null, claimedBy: null, updatedAt: now })
					.where(eq(computeJobs.id, row.id));
				requeued++;
			} else {
				await tx
					.update(computeJobs)
					.set({
						status: "failed",
						errorCode: "worker_lease_expired",
						errorMessage: `lease expired ${row.attempts}× without progress; max attempts reached`,
						completedAt: now,
						updatedAt: now,
						leaseUntil: null,
						claimedBy: null,
					})
					.where(eq(computeJobs.id, row.id));
				failed++;
			}
		}
		return { requeued, failed };
	});
}
