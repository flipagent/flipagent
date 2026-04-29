/**
 * `/v1/queue` — pending-deal queue. Each row is a snapshot the scan
 * worker dropped here when it found an above-margin opportunity in one
 * of the caller's watchlists. The user reviews + approves; approval
 * returns an `executeUrl` deeplink for now (the eBay Order API path
 * stays at 501 until tenant approval lands).
 *
 *   GET   /v1/queue                — pending deals (most recent first)
 *   POST  /v1/queue/:id/approve    — mark approved + return deeplink
 *   POST  /v1/queue/:id/dismiss    — drop from pending
 */

import { QueueDecisionResponse, type QueuedDeal, QueueListResponse } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { type DealQueueRow, dealQueue } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const queueRoute = new Hono();

const IdParam = Type.Object({ id: Type.String({ format: "uuid" }) });
const StatusQuery = Type.Object({
	status: Type.Optional(
		Type.Union([
			Type.Literal("pending"),
			Type.Literal("approved"),
			Type.Literal("dismissed"),
			Type.Literal("expired"),
			Type.Literal("all"),
		]),
	),
});

function toDto(row: DealQueueRow): QueuedDeal {
	return {
		id: row.id,
		watchlistId: row.watchlistId,
		legacyItemId: row.legacyItemId,
		itemWebUrl: row.itemWebUrl,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
		notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null,
		itemSnapshot: row.itemSnapshot as Record<string, unknown>,
		evaluationSnapshot: row.evaluationSnapshot as Record<string, unknown>,
	};
}

queueRoute.get(
	"/",
	describeRoute({
		tags: ["Overnight"],
		summary: "List queued deals (default: pending only)",
		description:
			"Returns deals snapshotted by watchlist scans. Default scope is `status=pending`; pass `status=all` to include approved / dismissed / expired entries for the dashboard's history view.",
		parameters: paramsFor("query", StatusQuery),
		responses: {
			200: jsonResponse("Queued deals.", QueueListResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbCoerce("query", StatusQuery),
	async (c) => {
		const key = c.var.apiKey;
		const { status = "pending" } = c.req.valid("query");
		const rows =
			status === "all"
				? await db.select().from(dealQueue).where(eq(dealQueue.apiKeyId, key.id)).orderBy(desc(dealQueue.createdAt))
				: await db
						.select()
						.from(dealQueue)
						.where(and(eq(dealQueue.apiKeyId, key.id), eq(dealQueue.status, status)))
						.orderBy(desc(dealQueue.createdAt));
		return c.json({ deals: rows.map(toDto) });
	},
);

queueRoute.post(
	"/:id/approve",
	describeRoute({
		tags: ["Overnight"],
		summary: "Approve a queued deal — returns the eBay deeplink to execute",
		description:
			"Marks the row `approved` + returns `executeUrl`. Until the eBay Order API tenant approval lands, the user clicks through and completes purchase on eBay; bridge / Order API automation will swap in transparently when configured. Idempotent: approving twice returns the same response.",
		parameters: paramsFor("path", IdParam),
		responses: {
			200: jsonResponse("Approval result.", QueueDecisionResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Deal not found or not owned by caller."),
		},
	}),
	requireApiKey,
	tbCoerce("param", IdParam),
	async (c) => {
		const key = c.var.apiKey;
		const { id } = c.req.valid("param");
		const [row] = await db
			.update(dealQueue)
			.set({ status: "approved", decidedAt: new Date() })
			.where(and(eq(dealQueue.id, id), eq(dealQueue.apiKeyId, key.id)))
			.returning();
		if (!row) return c.json({ error: "not_found" as const, message: `deal ${id} not found` }, 404);
		return c.json({ id: row.id, status: row.status, executeUrl: row.itemWebUrl });
	},
);

queueRoute.post(
	"/:id/dismiss",
	describeRoute({
		tags: ["Overnight"],
		summary: "Dismiss a queued deal",
		parameters: paramsFor("path", IdParam),
		responses: {
			200: jsonResponse("Dismiss result.", QueueDecisionResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Deal not found or not owned by caller."),
		},
	}),
	requireApiKey,
	tbCoerce("param", IdParam),
	async (c) => {
		const key = c.var.apiKey;
		const { id } = c.req.valid("param");
		const [row] = await db
			.update(dealQueue)
			.set({ status: "dismissed", decidedAt: new Date() })
			.where(and(eq(dealQueue.id, id), eq(dealQueue.apiKeyId, key.id)))
			.returning();
		if (!row) return c.json({ error: "not_found" as const, message: `deal ${id} not found` }, 404);
		return c.json({ id: row.id, status: row.status });
	},
);
