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
	appendEvent,
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
	 * pipeline event to the job's `events` column, and a `cancelCheck`
	 * it should call between steps.
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
	// Per-job FIFO queue for event writes. Pipeline code uses a sync
	// `(event) => void` listener type, so callers like `emitCachedStep`
	// fire `started` and `succeeded` back-to-back without awaiting the
	// dispatcher's append. Without serialisation those two UPDATEs race
	// to acquire the row lock; if `succeeded` wins, the SSE replay
	// yields events in the wrong order and the SDK's StepTracker leaves
	// the row stuck on `status: "running"` even though the result body
	// landed (the `started` event arriving second resets status). Chain
	// every append behind the previous one so JS-emit order is the
	// DB-commit order, regardless of whether the caller awaits.
	let writeChain: Promise<void> = Promise.resolve();
	const onStep: (event: unknown) => Promise<void> = (event) => {
		writeChain = writeChain.then(() => appendEvent(job.id, event));
		return writeChain;
	};
	const cancelCheck: () => Promise<void> = async () => {
		if (await isCancelRequested(job.id)) throw new CancelledError();
	};

	try {
		const result = await opts.run(onStep, cancelCheck);
		// Drain queued event writes before flipping the row to terminal.
		// SSE subscribers see `status: completed` and the `done` payload
		// in the same poll tick they see new events, so any unflushed
		// appends after the terminal flip would race with stream close.
		await writeChain.catch(() => {});
		return await transitionToCompleted(job.id, workerId, result);
	} catch (err) {
		await writeChain.catch(() => {});
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
