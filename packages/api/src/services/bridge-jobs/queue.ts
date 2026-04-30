/**
 * Bridge-job queue. Backs every typed bridge surface — `/v1/buy/order/*`
 * (eBay buy), `/v1/forwarder/*` (package forwarders), `/v1/browser/*`
 * (DOM ops), and extension control. Pure DB ops + status transitions; no
 * HTTP, no browser automation. Routes enqueue work; the bridge longpoll
 * uses `claimNextForApiKey` to atomically pick up jobs for whichever
 * bridge client (Chrome extension today) is polling on behalf of the user.
 *
 * Status machine (enforced in `transition`):
 *   queued ─► claimed ─► (awaiting_user_confirm | placing) ─► (completed | failed)
 *   queued ─► cancelled
 *   queued ─► expired                              (background sweeper)
 *   *      ─► cancelled (only from non-terminal)
 */

import { and, asc, eq, gt, lt, notInArray, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { bridgeJobs, type BridgeJob as DbBridgeJob, expenseEvents, type NewBridgeJob } from "../../db/schema.js";

const DEFAULT_TTL_MS = 30 * 60_000; // 30 min — generous for first-time login + 2FA

export const BRIDGE_JOB_TERMINAL = new Set<DbBridgeJob["status"]>(["completed", "failed", "cancelled", "expired"]);

export interface CreateBridgeJobInput {
	apiKeyId: string;
	userId: string | null;
	source: "ebay" | "planetexpress" | "control" | "browser" | "ebay_data";
	itemId: string;
	quantity: number;
	maxPriceCents: number | null;
	idempotencyKey: string | null;
	metadata: Record<string, unknown> | null;
}

export async function createBridgeJob(input: CreateBridgeJobInput): Promise<DbBridgeJob> {
	if (input.idempotencyKey) {
		const existing = await db
			.select()
			.from(bridgeJobs)
			.where(and(eq(bridgeJobs.apiKeyId, input.apiKeyId), eq(bridgeJobs.idempotencyKey, input.idempotencyKey)))
			.limit(1);
		if (existing[0]) return existing[0];
	}
	const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
	const insert: NewBridgeJob = {
		apiKeyId: input.apiKeyId,
		userId: input.userId,
		source: input.source,
		itemId: input.itemId,
		quantity: input.quantity,
		maxPriceCents: input.maxPriceCents,
		idempotencyKey: input.idempotencyKey,
		metadata: input.metadata,
		expiresAt,
	};
	const [row] = await db.insert(bridgeJobs).values(insert).returning();
	if (!row) throw new Error("bridgeJobs insert returned no row");
	return row;
}

export async function getJobForApiKey(id: string, apiKeyId: string): Promise<DbBridgeJob | null> {
	const rows = await db
		.select()
		.from(bridgeJobs)
		.where(and(eq(bridgeJobs.id, id), eq(bridgeJobs.apiKeyId, apiKeyId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Atomic claim. Marks one queued, non-expired job as `claimed` and returns it.
 * Uses a transaction with `FOR UPDATE SKIP LOCKED` so concurrent bridge
 * clients (or accidentally duplicated ones) don't pick the same row.
 * Returns null if nothing's waiting.
 */
export async function claimNextForApiKey(apiKeyId: string, bridgeTokenId: string): Promise<DbBridgeJob | null> {
	const now = new Date();
	return await db.transaction(async (tx) => {
		const candidates = await tx
			.select({ id: bridgeJobs.id })
			.from(bridgeJobs)
			.where(and(eq(bridgeJobs.apiKeyId, apiKeyId), eq(bridgeJobs.status, "queued"), gt(bridgeJobs.expiresAt, now)))
			.orderBy(asc(bridgeJobs.createdAt))
			.limit(1)
			.for("update", { skipLocked: true });
		if (candidates.length === 0) return null;
		const id = candidates[0]?.id;
		if (!id) return null;
		const [row] = await tx
			.update(bridgeJobs)
			.set({
				status: "claimed",
				claimedByTokenId: bridgeTokenId,
				claimedAt: now,
				updatedAt: now,
			})
			.where(eq(bridgeJobs.id, id))
			.returning();
		return row ?? null;
	});
}

export interface TransitionInput {
	id: string;
	apiKeyId: string;
	to: DbBridgeJob["status"];
	ebayOrderId?: string;
	totalCents?: number;
	receiptUrl?: string;
	failureReason?: string;
	/** Task-specific payload (e.g., PE pull_packages → { packages: [...] }). */
	result?: Record<string, unknown>;
}

/**
 * Move a bridge job to a new status. Idempotent at the terminal layer:
 * once a row is in `completed` / `failed` / `cancelled` / `expired`,
 * subsequent transitions are silent no-ops — the existing row is returned
 * unchanged. We enforce that with a `status NOT IN terminal` filter on
 * the UPDATE so a flaky retry of `result` from the bridge can't overwrite
 * a real outcome (e.g. completed → failed because a 30s-late retry
 * collided with the real success).
 *
 * Returns `null` only when the row doesn't exist (or doesn't belong to
 * this api key) — that maps to 409 in the route. Existing-terminal
 * returns the current row so the bridge sees 200 ok.
 */
export async function transition(input: TransitionInput): Promise<DbBridgeJob | null> {
	const now = new Date();
	const set: Partial<typeof bridgeJobs.$inferInsert> = {
		status: input.to,
		updatedAt: now,
	};
	if (input.ebayOrderId !== undefined) set.ebayOrderId = input.ebayOrderId;
	if (input.totalCents !== undefined) set.totalCents = input.totalCents;
	if (input.receiptUrl !== undefined) set.receiptUrl = input.receiptUrl;
	if (input.failureReason !== undefined) set.failureReason = input.failureReason;
	if (input.result !== undefined) set.result = input.result;
	if (BRIDGE_JOB_TERMINAL.has(input.to)) set.completedAt = now;

	const [row] = await db
		.update(bridgeJobs)
		.set(set)
		.where(
			and(
				eq(bridgeJobs.id, input.id),
				eq(bridgeJobs.apiKeyId, input.apiKeyId),
				notInArray(bridgeJobs.status, [...BRIDGE_JOB_TERMINAL] as DbBridgeJob["status"][]),
			),
		)
		.returning();
	if (!row) {
		// UPDATE matched zero rows — either the job doesn't exist or it was
		// already terminal. Fetch and return the current row so terminal-
		// after-terminal is a 200 no-op (matches the bridge docstring); a
		// truly missing id stays null and surfaces as 409.
		const [existing] = await db
			.select()
			.from(bridgeJobs)
			.where(and(eq(bridgeJobs.id, input.id), eq(bridgeJobs.apiKeyId, input.apiKeyId)))
			.limit(1);
		return existing ?? null;
	}

	// Closing the loop: a successful eBay buy auto-records the cost in the
	// expense ledger so portfolio P&L tracks reseller spend without
	// requiring a separate expenses_record call. eBay-only for now; other
	// sources (Amazon, Mercari) get the same treatment when added.
	// `control` (reload_extension etc.) and `planetexpress` (read-only)
	// stay out of the ledger.
	if (input.to === "completed" && row.source === "ebay" && row.totalCents != null) {
		await recordPurchaseExpense(row).catch((err) => console.error("[bridge-jobs] expense ledger write failed:", err));
	}

	return row;
}

async function recordPurchaseExpense(row: DbBridgeJob): Promise<void> {
	const totalCents = row.totalCents ?? 0;
	if (totalCents <= 0) return;
	await db.insert(expenseEvents).values({
		apiKeyId: row.apiKeyId,
		kind: "purchased",
		sku: row.itemId,
		marketplace: `${row.source}_us`,
		externalId: row.ebayOrderId ?? row.id,
		amountCents: totalCents,
		occurredAt: row.completedAt ?? new Date(),
		payload: {
			purchaseOrderId: row.id,
			receiptUrl: row.receiptUrl ?? null,
		},
	});
}

export async function cancelJob(id: string, apiKeyId: string): Promise<DbBridgeJob | null> {
	const now = new Date();
	const [row] = await db
		.update(bridgeJobs)
		.set({ status: "cancelled", updatedAt: now, completedAt: now })
		.where(
			and(
				eq(bridgeJobs.id, id),
				eq(bridgeJobs.apiKeyId, apiKeyId),
				or(
					eq(bridgeJobs.status, "queued"),
					eq(bridgeJobs.status, "claimed"),
					eq(bridgeJobs.status, "awaiting_user_confirm"),
				),
			),
		)
		.returning();
	return row ?? null;
}

/**
 * Server-side sync wait — poll the job until it reaches a terminal state,
 * then return the row. Used by the synchronous browser-primitive endpoints
 * (`/v1/browser/*`) to give callers a single round-trip experience instead
 * of "queue + poll" two-step.
 *
 * Polls the DB every 300 ms; for our scope (single bridge client per api
 * key, ≤ a few jobs/min) this is fine. If usage grows, swap to Postgres
 * LISTEN/NOTIFY.
 */
export async function waitForTerminal(id: string, apiKeyId: string, timeoutMs = 25_000): Promise<DbBridgeJob | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const job = await getJobForApiKey(id, apiKeyId);
		if (!job) return null;
		if (BRIDGE_JOB_TERMINAL.has(job.status)) return job;
		await new Promise((r) => setTimeout(r, 300));
	}
	return await getJobForApiKey(id, apiKeyId);
}

/**
 * Best-effort sweeper for queued/claimed jobs whose `expires_at` is in the
 * past. Run periodically (cron, or on demand) — until then, callers see
 * stale state. Cheap query (indexed on status,expires_at).
 */
export async function expireStale(): Promise<number> {
	const now = new Date();
	const result = await db
		.update(bridgeJobs)
		.set({ status: "expired", updatedAt: now, completedAt: now })
		.where(
			and(
				or(
					eq(bridgeJobs.status, "queued"),
					eq(bridgeJobs.status, "claimed"),
					eq(bridgeJobs.status, "awaiting_user_confirm"),
					eq(bridgeJobs.status, "placing"),
				),
				lt(bridgeJobs.expiresAt, now),
			),
		)
		.returning();
	return result.length;
}

/**
 * Convert a DB row to the public TypeBox shape. All timestamps as ISO,
 * nullables explicitly null (not undefined) so JSON.stringify keeps them.
 */
export function toPublicShape(row: DbBridgeJob): {
	id: string;
	source: "ebay" | "planetexpress" | "control" | "browser" | "ebay_data";
	itemId: string;
	quantity: number;
	maxPriceCents: number | null;
	status: DbBridgeJob["status"];
	ebayOrderId: string | null;
	totalCents: number | null;
	receiptUrl: string | null;
	failureReason: string | null;
	result: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
} {
	return {
		id: row.id,
		source: row.source as "ebay" | "planetexpress" | "control" | "browser" | "ebay_data",
		itemId: row.itemId,
		quantity: row.quantity,
		maxPriceCents: row.maxPriceCents,
		status: row.status,
		ebayOrderId: row.ebayOrderId,
		totalCents: row.totalCents,
		receiptUrl: row.receiptUrl,
		failureReason: row.failureReason,
		result: (row.result as Record<string, unknown> | null) ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
	};
}
