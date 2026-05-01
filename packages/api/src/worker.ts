#!/usr/bin/env node
/**
 * flipagent worker — long-running background process that claims and
 * executes compute jobs (`evaluate`, `discover`) from the
 * `compute_jobs` queue. Runs in its own container; the API container
 * only enqueues. Same image, separate entrypoint — the worker
 * Container App's `command` is `["node", "dist/worker.js"]`.
 *
 * Concurrency: each replica runs one job at a time (MAX_CONCURRENCY=1);
 * KEDA scales replicas based on queue depth instead. Keeps memory peaks
 * bounded per process.
 *
 * Lifecycle per job:
 *   1. claimNextJob — atomic FOR UPDATE SKIP LOCKED, sets lease_until
 *   2. heartbeat every WORKER_HEARTBEAT_MS via renewLease so the lease
 *      never expires under live work
 *   3. runJob — executes the pipeline; transitionTo* writes terminal
 *   4. heartbeat clears, loop
 *
 * On SIGTERM (deploy / KEDA scale-down): stop claiming new jobs; wait
 * up to GRACE_MS for the in-flight job to finish; if still running
 * past grace, releaseLease so another replica can re-claim.
 *
 * On crash / OOM / SIGKILL: lease falls in the past; the periodic
 * recovery sweep (here AND on next worker boot) requeues if attempts
 * remain or fails the row with `worker_lease_expired`.
 */

import { hostname } from "node:os";
import { eq } from "drizzle-orm";
import { closeDb, db } from "./db/client.js";
import { type ApiKey, apiKeys, type ComputeJob } from "./db/schema.js";
import { runJob } from "./services/compute-jobs/dispatcher.js";
import {
	claimNextJob,
	recoverExpiredLeases,
	releaseLease,
	renewLease,
	transitionToFailed,
} from "./services/compute-jobs/queue.js";
import { runEvaluatePipeline } from "./services/evaluate/run.js";
import { runDiscoverPipeline } from "./services/evaluate/run-discover.js";

const WORKER_LEASE_MS = Number.parseInt(process.env.WORKER_LEASE_MS ?? "300000", 10); // 5min
const WORKER_HEARTBEAT_MS = Number.parseInt(process.env.WORKER_HEARTBEAT_MS ?? "30000", 10); // 30s
const WORKER_MAX_ATTEMPTS = Number.parseInt(process.env.WORKER_MAX_ATTEMPTS ?? "3", 10);
const WORKER_POLL_INTERVAL_MS = Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "1000", 10);
const WORKER_RECOVERY_INTERVAL_MS = Number.parseInt(process.env.WORKER_RECOVERY_INTERVAL_MS ?? "60000", 10);
const WORKER_SHUTDOWN_GRACE_MS = Number.parseInt(process.env.WORKER_SHUTDOWN_GRACE_MS ?? "30000", 10);

const workerId = `worker-${hostname()}-${process.pid}`;

let shuttingDown = false;
/** Currently-running job — set when claim succeeds, cleared when terminal. Used by graceful shutdown. */
let inFlightJobId: string | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchApiKey(id: string): Promise<ApiKey | null> {
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
	return rows[0] ?? null;
}

interface EvaluateParams {
	itemId: string;
	lookbackDays?: number;
	soldLimit?: number;
	opts?: Record<string, unknown>;
}

interface DiscoverParams {
	q: string;
	categoryId?: string;
	filter?: string;
	limit?: number;
	lookbackDays?: number;
	soldLimit?: number;
	opts?: Record<string, unknown>;
}

async function runOneJob(job: ComputeJob): Promise<void> {
	inFlightJobId = job.id;

	const apiKey = await fetchApiKey(job.apiKeyId);
	if (!apiKey) {
		await transitionToFailed(
			job.id,
			workerId,
			"api_key_not_found",
			`apiKey ${job.apiKeyId} no longer exists; cannot run job`,
		);
		inFlightJobId = null;
		return;
	}

	// Heartbeat: renew the lease deadline so a healthy worker never has
	// its lease expire mid-run. If renewLease returns null we've lost
	// the lease (network partition long enough that the recovery sweep
	// took it over) — log it; transitionTo* will fail at the end and
	// the new lease holder will run the job again. We can't abort the
	// pipeline mid-step from here.
	let heartbeatLost = false;
	const heartbeatTimer = setInterval(() => {
		if (heartbeatLost) return;
		void renewLease(job.id, workerId, WORKER_LEASE_MS)
			.then((row) => {
				if (!row) {
					heartbeatLost = true;
					console.error(`[worker] lease for ${job.id} taken over; in-flight pipeline will exit no-op`);
				}
			})
			.catch((err) => console.error(`[worker] heartbeat for ${job.id} threw:`, err));
	}, WORKER_HEARTBEAT_MS);

	try {
		if (job.kind === "evaluate") {
			const params = job.params as EvaluateParams;
			await runJob({
				job,
				workerId,
				run: (onStep, cancelCheck) =>
					runEvaluatePipeline({
						itemId: params.itemId,
						lookbackDays: params.lookbackDays,
						soldLimit: params.soldLimit,
						apiKey,
						opts: params.opts as never,
						onStep: (event) => void onStep(event),
						cancelCheck,
					}),
			});
		} else if (job.kind === "discover") {
			const params = job.params as DiscoverParams;
			await runJob({
				job,
				workerId,
				run: (onStep, cancelCheck) =>
					runDiscoverPipeline({
						q: params.q,
						categoryId: params.categoryId,
						filter: params.filter,
						limit: params.limit,
						lookbackDays: params.lookbackDays,
						soldLimit: params.soldLimit,
						apiKey,
						opts: params.opts as never,
						onStep: (event) => void onStep(event),
						cancelCheck,
					}),
			});
		} else {
			await transitionToFailed(
				job.id,
				workerId,
				"unknown_kind",
				`unknown compute_job kind ${(job as { kind: unknown }).kind}`,
			);
		}
	} finally {
		clearInterval(heartbeatTimer);
		inFlightJobId = null;
	}
}

async function mainLoop(): Promise<void> {
	while (!shuttingDown) {
		const claimed = await claimNextJob({ workerId, leaseMs: WORKER_LEASE_MS }).catch((err) => {
			console.error("[worker] claimNextJob threw:", err);
			return null;
		});
		if (!claimed) {
			await sleep(WORKER_POLL_INTERVAL_MS);
			continue;
		}
		console.log(`[worker] claim ${claimed.id} kind=${claimed.kind} attempt=${claimed.attempts}`);
		const startedAt = Date.now();
		await runOneJob(claimed).catch((err) => console.error(`[worker] runOneJob ${claimed.id} unhandled:`, err));
		console.log(`[worker] done ${claimed.id} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
	}
}

async function recoveryLoop(): Promise<void> {
	while (!shuttingDown) {
		const result = await recoverExpiredLeases({ maxAttempts: WORKER_MAX_ATTEMPTS }).catch((err) => {
			console.error("[worker] recoverExpiredLeases threw:", err);
			return { requeued: 0, failed: 0 };
		});
		if (result.requeued > 0 || result.failed > 0) {
			console.log(`[worker] recovery sweep: requeued=${result.requeued} failed=${result.failed}`);
		}
		await sleep(WORKER_RECOVERY_INTERVAL_MS);
	}
}

async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	console.log(`[worker] received ${signal}, draining (grace ${WORKER_SHUTDOWN_GRACE_MS}ms)`);
	shuttingDown = true;
	const start = Date.now();
	while (inFlightJobId && Date.now() - start < WORKER_SHUTDOWN_GRACE_MS) {
		await sleep(500);
	}
	if (inFlightJobId) {
		// Pipeline still running past grace — release the lease so
		// another replica picks it up. The current pipeline will try to
		// transitionTo* at completion but fail (claimedBy mismatch),
		// which is the correct outcome.
		console.warn(`[worker] grace expired, releasing lease for ${inFlightJobId}`);
		await releaseLease(inFlightJobId, workerId).catch((err) => console.error(`[worker] releaseLease failed:`, err));
	}
	await closeDb();
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Log + crash on stray async failures. With lease-based recovery, a
// crashing worker is safe — the lease expires, the recovery sweep
// requeues, KEDA brings up a replacement. Better to fail fast with a
// telemetry trail than mask a corrupt state.
process.on("unhandledRejection", (reason) => {
	console.error("[worker] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
	console.error("[worker] uncaughtException:", err);
	process.exit(1);
});

console.log(
	`[worker] starting ${workerId}` +
		` lease=${WORKER_LEASE_MS}ms heartbeat=${WORKER_HEARTBEAT_MS}ms` +
		` poll=${WORKER_POLL_INTERVAL_MS}ms maxAttempts=${WORKER_MAX_ATTEMPTS}`,
);

// Boot recovery — handle anything left `running` from a prior crash
// before claiming new work. Idempotent with the periodic loop below.
const initial = await recoverExpiredLeases({ maxAttempts: WORKER_MAX_ATTEMPTS }).catch((err) => {
	console.error("[worker] boot recovery failed:", err);
	return { requeued: 0, failed: 0 };
});
if (initial.requeued > 0 || initial.failed > 0) {
	console.log(`[worker] boot recovery: requeued=${initial.requeued} failed=${initial.failed}`);
}

await Promise.all([mainLoop(), recoveryLoop()]);
