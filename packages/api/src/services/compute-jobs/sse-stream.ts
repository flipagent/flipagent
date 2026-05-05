/**
 * SSE streaming helper for compute_jobs. Owns the full client-facing
 * stream lifecycle for `/v1/evaluate/jobs/{id}/stream`:
 *
 *   1. Replay events accumulated in the row's `events` column so a
 *      late subscriber sees the full progress.
 *   2. Emit a synthesised terminal event when the row was already
 *      done at subscribe time.
 *   3. Cross-process polling — the API container forwards events
 *      written by the worker container. Re-reads
 *      `compute_jobs.events + status` every POLL_INTERVAL_MS, emits
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

function eventPayload(event: unknown): { event: string; data: string } {
	const e = event as { kind?: string; patch?: unknown };
	const kind = e.kind ?? "message";
	// Partial events ship the patch as the bare wire payload — the
	// schema IS `Partial<EvaluatePartial>`, no envelope. Step events
	// (started/succeeded/failed) include their full record so the
	// trace UI gets `key`, `label`, `result`, `durationMs`, etc.
	const data = kind === "partial" ? JSON.stringify(e.patch ?? null) : JSON.stringify(event);
	return { event: kind, data };
}

function terminalPayloadFromRow(row: ComputeJob): { event: string; data: string } | null {
	if (row.status === "completed") {
		return { event: "done", data: JSON.stringify(row.result ?? null) };
	}
	if (row.status === "cancelled") {
		return { event: "cancelled", data: JSON.stringify({}) };
	}
	if (row.status === "failed") {
		const payload: Record<string, unknown> = { error: row.errorCode, message: row.errorMessage };
		// Mirror the sync POST: typed errors that ship a structured
		// `details` payload (e.g. `variation_required` with the enumerated
		// variations) must reach SSE subscribers too — they're the sole
		// signal an async client has to recover the failure.
		if (row.errorDetails != null) payload.details = row.errorDetails;
		return { event: "error", data: JSON.stringify(payload) };
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
	// 1. Replay accumulated events.
	const initialEvents = (job.events as unknown[]) ?? [];
	for (const event of initialEvents) {
		await stream.writeSSE(eventPayload(event));
	}

	// 2. Already terminal? Emit + return; hono closes the response.
	const earlyTerminal = terminalPayloadFromRow(job);
	if (earlyTerminal) {
		await stream.writeSSE(earlyTerminal);
		return;
	}

	// 3. Polling loop — re-read the row, forward any new entries,
	// stop on terminal or client disconnect.
	let lastSeenLen = initialEvents.length;
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

		const eventsArr = (fresh.events as unknown[]) ?? [];
		if (eventsArr.length > lastSeenLen) {
			const newEvents = eventsArr.slice(lastSeenLen);
			for (const event of newEvents) {
				await stream.writeSSE(eventPayload(event));
			}
			lastSeenLen = eventsArr.length;
		}

		const terminal = terminalPayloadFromRow(fresh);
		if (terminal) {
			await stream.writeSSE(terminal);
			return;
		}
	}
}
