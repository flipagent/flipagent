/**
 * Compute-job dispatcher. Runs a pipeline against an already-claimed
 * `compute_jobs` row, persisting trace events and the terminal state.
 *
 * Lives in the worker container (entrypoint: `worker.ts`); the API
 * container only enqueues. The worker calls `claimNextJob` from
 * `queue.ts`, then `runJob` here, then loops.
 *
 * Errors never propagate — caught and translated into a `failed` /
 * `cancelled` row so the queue surface always reports a definite
 * outcome. Lease ownership (`claimedBy`) is enforced by `transitionTo*`
 * so a re-claimed-after-expiry race can't double-write.
 */

import type { ComputeJob } from "../../db/schema.js";
import {
	appendTrace,
	isCancelRequested,
	transitionToCancelled,
	transitionToCompleted,
	transitionToFailed,
} from "./queue.js";

/** Cooperative cancellation throw — the dispatcher catches it and transitions to `cancelled`. */
export class CancelledError extends Error {
	constructor() {
		super("compute_job_cancelled");
		this.name = "CancelledError";
	}
}

export interface RunJobOptions {
	job: ComputeJob;
	/** Stable worker identifier (must match the row's `claimed_by`). */
	workerId: string;
	/**
	 * Pipeline runner — receives an `onStep` callback that persists each
	 * trace event to the job's `trace` column, and a `cancelCheck` it
	 * should call between steps.
	 */
	run: (onStep: (event: unknown) => Promise<void> | void, cancelCheck: () => Promise<void>) => Promise<unknown>;
}

/**
 * Execute a claimed job's pipeline to terminal. Resolves with the final
 * row (completed / failed / cancelled), never rejects. The transition
 * may return null if the lease was taken over mid-run by the recovery
 * sweep — caller treats that as "another worker now owns this", so
 * abandons silently.
 */
export async function runJob(opts: RunJobOptions): Promise<ComputeJob | null> {
	const { job, workerId } = opts;
	const onStep: (event: unknown) => Promise<void> = async (event) => {
		await appendTrace(job.id, event);
	};
	const cancelCheck: () => Promise<void> = async () => {
		if (await isCancelRequested(job.id)) throw new CancelledError();
	};

	try {
		const result = await opts.run(onStep, cancelCheck);
		return await transitionToCompleted(job.id, workerId, result);
	} catch (err) {
		if (err instanceof CancelledError) {
			return await transitionToCancelled(job.id, workerId);
		}
		const { code, message, details } = errorToFields(err);
		return await transitionToFailed(job.id, workerId, code, message, details);
	}
}

function errorToFields(err: unknown): { code: string; message: string; details?: unknown } {
	if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
		const code = (err as { code: string }).code;
		const message = err instanceof Error ? err.message : String(err);
		// `EvaluateError.details` (and any sibling typed error that adopts
		// the same convention) carries a structured payload — e.g. the
		// enumerated `variations[]` for `variation_required`. Forward it
		// so the route + SSE layers can surface it to the caller.
		const detailsField = (err as { details?: unknown }).details;
		return detailsField !== undefined ? { code, message, details: detailsField } : { code, message };
	}
	return {
		code: "internal",
		message: err instanceof Error ? err.message : String(err),
	};
}
