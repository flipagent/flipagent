/**
 * SSE streaming helper for compute_jobs. Owns the full client-facing
 * stream lifecycle for `/v1/{evaluate,discover}/jobs/{id}/stream`:
 *
 *   1. Replay events accumulated in the row's `trace` column so a
 *      late subscriber sees the full progress.
 *   2. Emit a synthesised terminal event when the row was already
 *      done at subscribe time.
 *   3. Cross-process polling — the API container forwards trace
 *      events written by the worker container. Re-reads
 *      `compute_jobs.trace + status` every POLL_INTERVAL_MS, emits
 *      any new entries since last snapshot, closes when the row
 *      reaches a terminal status.
 *   4. Drop the polling loop cleanly on client disconnect (tab close /
 *      fetch abort).
 *
 * 500ms polling is invisible against multi-minute pipelines and
 * sidesteps the connection-per-subscriber footprint of LISTEN/NOTIFY
 * (each NOTIFY subscriber on postgres.js holds a dedicated client).
 *
 * Callers pre-fetch the snapshot so they can return 404 via `c.json`
 * before opening the SSE response (HTTP error codes can't be sent
 * after streamSSE starts the response). After the snapshot, this
 * helper owns everything inside the streaming callback.
 */

import type { Context } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import type { ComputeJob } from "../../db/schema.js";
import { getJob } from "./queue.js";

const POLL_INTERVAL_MS = 500;

function stepPayload(event: unknown): { event: string; data: string } {
	const kind = (event as { kind?: string }).kind ?? "message";
	return { event: kind, data: JSON.stringify(event) };
}

function terminalPayloadFromRow(row: ComputeJob): { event: string; data: string } | null {
	if (row.status === "completed") {
		return { event: "done", data: JSON.stringify(row.result ?? null) };
	}
	if (row.status === "cancelled") {
		return { event: "cancelled", data: JSON.stringify({}) };
	}
	if (row.status === "failed") {
		return {
			event: "error",
			data: JSON.stringify({ error: row.errorCode, message: row.errorMessage }),
		};
	}
	return null;
}

/** Sleep that resolves early when the request is aborted. */
function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export async function streamComputeJobEvents(c: Context, stream: SSEStreamingApi, job: ComputeJob): Promise<void> {
	// 1. Replay accumulated trace.
	const initialTrace = (job.trace as unknown[]) ?? [];
	for (const event of initialTrace) {
		await stream.writeSSE(stepPayload(event));
	}

	// 2. Already terminal? Emit + return; hono closes the response.
	const earlyTerminal = terminalPayloadFromRow(job);
	if (earlyTerminal) {
		await stream.writeSSE(earlyTerminal);
		return;
	}

	// 3. Polling loop — re-read the row, forward any new trace entries,
	// stop on terminal or client disconnect.
	let lastSeenLen = initialTrace.length;
	const signal = c.req.raw.signal;

	while (!signal.aborted) {
		await sleepOrAbort(POLL_INTERVAL_MS, signal);
		if (signal.aborted) break;

		const fresh = await getJob(job.id, job.apiKeyId);
		if (!fresh) {
			// Row vanished (retention sweep) — synthesise a failed event so
			// the client doesn't hang.
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({ error: "not_found", message: "job no longer exists" }),
			});
			return;
		}

		const traceArr = (fresh.trace as unknown[]) ?? [];
		if (traceArr.length > lastSeenLen) {
			const newEvents = traceArr.slice(lastSeenLen);
			for (const event of newEvents) {
				await stream.writeSSE(stepPayload(event));
			}
			lastSeenLen = traceArr.length;
		}

		const terminal = terminalPayloadFromRow(fresh);
		if (terminal) {
			await stream.writeSSE(terminal);
			return;
		}
	}
}
