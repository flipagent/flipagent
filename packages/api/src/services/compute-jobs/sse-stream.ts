/**
 * SSE streaming helper for compute_jobs. Owns the full client-facing
 * stream lifecycle for `/v1/{evaluate,discover}/jobs/{id}/stream`:
 *
 *   1. Replay events accumulated in the row's `trace` column so a
 *      late subscriber sees the full progress.
 *   2. Emit a synthesised terminal event when the row was already
 *      done at subscribe time.
 *   3. Pump live worker events through a serialised queue with each
 *      `writeSSE` awaited — earlier versions used fire-and-forget
 *      writes, which let hono close the response before the terminal
 *      `done` event flushed (clients saw "stream ended without a
 *      result" even though the worker had completed cleanly).
 *   4. Race recovery: a fresh `getJob` after subscribe catches the
 *      window where the worker emitted `publishLive("terminal")`
 *      between our snapshot and the listener attaching — newly-landed
 *      trace events get synthesised back into the queue.
 *   5. Drop the listener cleanly on client disconnect (tab close /
 *      fetch abort) so dispatcher pub/sub doesn't accumulate dead
 *      subscribers.
 *
 * Callers pre-fetch the snapshot so they can return 404 via `c.json`
 * before opening the SSE response (HTTP error codes can't be sent
 * after streamSSE starts the response). After the snapshot, this
 * helper owns everything inside the streaming callback.
 */

import type { Context } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import type { ComputeJob } from "../../db/schema.js";
import { getJob, type LiveEvent, subscribeLive } from "./queue.js";

interface QueueItem {
	terminal: boolean;
	payload: { event: string; data: string };
}

function stepPayload(event: unknown): { event: string; data: string } {
	const kind = (event as { kind?: string }).kind ?? "message";
	return { event: kind, data: JSON.stringify(event) };
}

function terminalPayload(live: LiveEvent & { kind: "terminal" }): { event: string; data: string } {
	if (live.status === "completed") {
		return { event: "done", data: JSON.stringify(live.result ?? null) };
	}
	if (live.status === "cancelled") {
		return { event: "cancelled", data: JSON.stringify({}) };
	}
	return {
		event: "error",
		data: JSON.stringify({ error: live.errorCode, message: live.errorMessage }),
	};
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

export async function streamComputeJobEvents(c: Context, stream: SSEStreamingApi, job: ComputeJob): Promise<void> {
	// 1. Replay accumulated trace.
	const traceEvents = (job.trace as unknown[]) ?? [];
	for (const event of traceEvents) {
		await stream.writeSSE(stepPayload(event));
	}

	// 2. Already terminal? Emit + return; hono closes the response.
	const earlyTerminal = terminalPayloadFromRow(job);
	if (earlyTerminal) {
		await stream.writeSSE(earlyTerminal);
		return;
	}

	// 3. Still running — set up the live pump.
	const queue: QueueItem[] = [];
	let wakeup: (() => void) | null = null;
	const wake = () => {
		wakeup?.();
		wakeup = null;
	};

	const unsubscribe = subscribeLive(job.id, (live) => {
		if (live.kind === "step") {
			queue.push({ terminal: false, payload: stepPayload(live.event) });
		} else {
			queue.push({ terminal: true, payload: terminalPayload(live) });
		}
		wake();
	});

	c.req.raw.signal.addEventListener("abort", wake);

	// 4. Race recovery: re-read after subscribe in case the worker
	// emitted publishLive in the window between our snapshot above
	// and the listener attaching above.
	void getJob(job.id, job.apiKeyId).then((fresh) => {
		if (!fresh) return;
		const oldLen = traceEvents.length;
		const newEvents = ((fresh.trace as unknown[]) ?? []).slice(oldLen);
		for (const event of newEvents) {
			queue.push({ terminal: false, payload: stepPayload(event) });
		}
		const recovered = terminalPayloadFromRow(fresh);
		if (recovered) queue.push({ terminal: true, payload: recovered });
		wake();
	});

	// 5. Drain the queue serially. Awaiting each writeSSE keeps the
	// terminal `done` flushed before we return — without this, hono
	// closes the response while the buffered write is still in
	// flight, and the client falls through to "stream ended without
	// a result".
	try {
		while (!c.req.raw.signal.aborted) {
			while (queue.length > 0) {
				const item = queue.shift();
				if (!item) break;
				await stream.writeSSE(item.payload);
				if (item.terminal) return;
			}
			await new Promise<void>((resolve) => {
				wakeup = resolve;
			});
		}
	} finally {
		unsubscribe();
	}
}
