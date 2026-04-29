/**
 * Calibration traces from delegate-mode `/v1/match`. Two-step write:
 *
 *   1. `saveDelegateTrace()` is called when we hand a prompt to the
 *      caller. Status `pending`, decisions null. Lets the caller
 *      finalise the row by `traceId` later without re-uploading the
 *      pool.
 *
 *   2. `finaliseDelegateTrace()` is called from `/v1/traces/match`
 *      when the caller posts their LLM's decisions. Sets `decisions`,
 *      `status='completed'`, `completedAt`.
 *
 * Both writes are gated by `OBSERVATION_ENABLED` on the host. If the
 * host hasn't opted in, `saveDelegateTrace` is a no-op (we still
 * return the prompt + traceId — the caller just can't post traces
 * back). This mirrors the hosted-only gating on `match_decisions`.
 *
 * Caller-side opt-out lives in the SDK / CLI / MCP via
 * `FLIPAGENT_TELEMETRY=0` — that prevents the `/v1/traces/match` POST
 * from happening at all.
 */

import { createHash } from "node:crypto";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { eq, sql } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { matchTraces } from "../../db/schema.js";

interface SaveArgs {
	traceId: string;
	candidate: ItemSummary;
	pool: ReadonlyArray<ItemSummary>;
	useImages: boolean;
	apiKeyId?: string;
}

function snapshot(item: ItemSummary) {
	return {
		itemId: item.itemId,
		title: item.title,
		condition: item.condition,
		conditionId: item.conditionId,
		price: item.price,
		lastSoldPrice: item.lastSoldPrice,
		imageUrl: item.image?.imageUrl,
	};
}

/**
 * Hash the API key id (or a stable proxy) into a short prefix used
 * for per-key rate-limit accounting on /v1/traces/match. We don't
 * persist the raw key id alongside the trace — only this prefix —
 * so traces can't be back-resolved to a user.
 */
function hashKeyPrefix(input: string | undefined): string | null {
	if (!input) return null;
	return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export async function saveDelegateTrace(args: SaveArgs): Promise<void> {
	if (!config.OBSERVATION_ENABLED) return;
	await db
		.insert(matchTraces)
		.values({
			traceId: args.traceId,
			candidateId: args.candidate.itemId,
			poolItemIds: args.pool.map((p) => p.itemId),
			candidateSnapshot: snapshot(args.candidate),
			poolSnapshot: args.pool.map(snapshot),
			useImages: args.useImages,
			status: "pending",
			apiKeyHashPrefix: hashKeyPrefix(args.apiKeyId),
		})
		.onConflictDoNothing();
}

interface FinaliseArgs {
	traceId: string;
	decisions: ReadonlyArray<{ itemId: string; bucket: "match" | "reject"; reason: string }>;
	llmModel?: string;
	clientVersion?: string;
}

export type FinaliseResult = { ok: true; stored: number } | { ok: false; reason: "not_found" | "already_completed" };

export async function finaliseDelegateTrace(args: FinaliseArgs): Promise<FinaliseResult> {
	if (!config.OBSERVATION_ENABLED) {
		// Host hasn't opted in to keeping traces. Pretend we stored it —
		// callers shouldn't have to branch on host-side telemetry config,
		// they only opt out via their own FLIPAGENT_TELEMETRY env var.
		return { ok: true, stored: 0 };
	}
	const [row] = await db.select().from(matchTraces).where(eq(matchTraces.traceId, args.traceId)).limit(1);
	if (!row) return { ok: false, reason: "not_found" };
	if (row.status === "completed") return { ok: false, reason: "already_completed" };

	await db
		.update(matchTraces)
		.set({
			status: "completed",
			decisions: args.decisions,
			llmModel: args.llmModel ?? null,
			clientVersion: args.clientVersion ?? null,
			completedAt: sql`NOW()`,
		})
		.where(eq(matchTraces.traceId, args.traceId));

	return { ok: true, stored: args.decisions.length };
}
