/**
 * In-process compute-job dispatcher. POST /v1/{evaluate,discover}{,/jobs}
 * calls `dispatch()` to kick off a pipeline asynchronously; the returned
 * promise resolves when the job reaches a terminal state. Sync routes
 * (`POST /v1/evaluate`, `POST /v1/discover`) await it and serve the
 * final result; async routes (`POST /v1/{evaluate,discover}/jobs`)
 * fire-and-forget.
 *
 * Single-replica deploy = no separate worker process. Pipelines run on
 * the same Node event loop as the API server. Crash recovery is via
 * `failOrphans()` from `queue.ts`, called on boot.
 */

import type { ComputeJob } from "../../db/schema.js";
import {
	appendTrace,
	isCancelRequested,
	publishLive,
	transitionToCancelled,
	transitionToCompleted,
	transitionToFailed,
	transitionToRunning,
} from "./queue.js";

/** Cooperative cancellation throw — the dispatcher catches it and transitions to `cancelled`. */
export class CancelledError extends Error {
	constructor() {
		super("compute_job_cancelled");
		this.name = "CancelledError";
	}
}

export interface DispatchOptions {
	jobId: string;
	/**
	 * Pipeline runner — receives an `onStep` callback that persists each
	 * trace event to the job's `trace` column AND broadcasts to live
	 * subscribers, plus a `cancelCheck` it should call between steps.
	 */
	run: (onStep: (event: unknown) => Promise<void> | void, cancelCheck: () => Promise<void>) => Promise<unknown>;
}

/**
 * Spawn the pipeline as a background task on the same event loop. The
 * returned promise resolves when the job reaches terminal status — sync
 * routes await it; async routes ignore it (they've already responded
 * with `{ jobId, status: "queued" }`).
 *
 * Errors are caught and translated to `failed` / `cancelled` rows — the
 * promise itself never rejects. Callers always get a `ComputeJob` (or
 * `null` on a transition contention edge case).
 */
export function dispatch(opts: DispatchOptions): Promise<ComputeJob | null> {
	return run(opts);
}

async function run(opts: DispatchOptions): Promise<ComputeJob | null> {
	const claimed = await transitionToRunning(opts.jobId);
	if (!claimed) {
		// transitionToRunning's WHERE requires status='queued'; the most
		// likely reason it fails is a cancel that won the race between
		// createJob and dispatch. Close any inflight /stream subscribers
		// with a terminal so they don't hang waiting for an event that
		// will never come.
		publishLive(opts.jobId, { kind: "terminal", status: "cancelled" });
		return null;
	}

	const onStep: (event: unknown) => Promise<void> = async (event) => {
		await appendTrace(opts.jobId, event);
		publishLive(opts.jobId, { kind: "step", event });
	};
	const cancelCheck: () => Promise<void> = async () => {
		if (await isCancelRequested(opts.jobId)) throw new CancelledError();
	};

	try {
		const result = await opts.run(onStep, cancelCheck);
		const done = await transitionToCompleted(opts.jobId, result);
		publishLive(opts.jobId, { kind: "terminal", status: "completed", result });
		return done;
	} catch (err) {
		if (err instanceof CancelledError) {
			const done = await transitionToCancelled(opts.jobId);
			publishLive(opts.jobId, { kind: "terminal", status: "cancelled" });
			return done;
		}
		const { code, message } = errorToFields(err);
		const done = await transitionToFailed(opts.jobId, code, message);
		publishLive(opts.jobId, { kind: "terminal", status: "failed", errorCode: code, errorMessage: message });
		return done;
	}
}

function errorToFields(err: unknown): { code: string; message: string } {
	if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
		const code = (err as { code: string }).code;
		const message = err instanceof Error ? err.message : String(err);
		return { code, message };
	}
	return {
		code: "internal",
		message: err instanceof Error ? err.message : String(err),
	};
}
