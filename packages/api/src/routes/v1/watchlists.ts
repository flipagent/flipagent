/**
 * `/v1/watchlists` — saved sweep CRUD. Each watchlist is scoped to an
 * api_key (the caller's). The scan worker (`services/watchlists/scan.ts`)
 * picks `enabled=true` rows whose `last_run_at` is older than their
 * cadence interval, runs Discover, and snapshots qualifying deals into
 * `deal_queue`.
 *
 *   POST   /v1/watchlists           — create
 *   GET    /v1/watchlists           — list
 *   PATCH  /v1/watchlists/:id       — update (name/criteria/cadence/enabled)
 *   DELETE /v1/watchlists/:id       — remove
 *   POST   /v1/watchlists/:id/run-now — manual trigger (returns immediately)
 */

import {
	WatchlistCreateRequest,
	type Watchlist as WatchlistDto,
	WatchlistListResponse,
	WatchlistUpdateRequest,
} from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { type Watchlist, watchlists } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { runWatchlistScan } from "../../services/watchlists/scan.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const watchlistsRoute = new Hono();

const IdParam = Type.Object({ id: Type.String({ format: "uuid" }) });

function toDto(row: Watchlist): WatchlistDto {
	return {
		id: row.id,
		name: row.name,
		criteria: row.criteria as WatchlistDto["criteria"],
		cadence: row.cadence,
		enabled: row.enabled,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
		lastRunError: row.lastRunError ?? null,
	};
}

watchlistsRoute.get(
	"/",
	describeRoute({
		tags: ["Overnight"],
		summary: "List the caller's saved watchlists",
		responses: {
			200: jsonResponse("Watchlists owned by the caller.", WatchlistListResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const key = c.var.apiKey;
		const rows = await db
			.select()
			.from(watchlists)
			.where(eq(watchlists.apiKeyId, key.id))
			.orderBy(desc(watchlists.createdAt));
		return c.json({ watchlists: rows.map(toDto) });
	},
);

watchlistsRoute.post(
	"/",
	describeRoute({
		tags: ["Overnight"],
		summary: "Create a watchlist",
		description:
			"Persist a Discover query as a saved sweep. The scan worker re-runs it on the chosen cadence and snapshots qualifying deals into `/v1/queue` for approval.",
		responses: {
			201: jsonResponse("Created watchlist.", Type.Object({ watchlist: { $ref: "Watchlist" } as never })),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbBody(WatchlistCreateRequest),
	async (c) => {
		const key = c.var.apiKey;
		const body = c.req.valid("json");
		const [row] = await db
			.insert(watchlists)
			.values({
				apiKeyId: key.id,
				name: body.name,
				criteria: body.criteria,
				cadence: body.cadence ?? "daily",
			})
			.returning();
		if (!row) return c.json({ error: "internal_error" as const, message: "insert failed" }, 500);
		return c.json({ watchlist: toDto(row) }, 201);
	},
);

watchlistsRoute.patch(
	"/:id",
	describeRoute({
		tags: ["Overnight"],
		summary: "Update a watchlist (criteria / cadence / enable / name)",
		parameters: paramsFor("path", IdParam),
		responses: {
			200: jsonResponse("Updated watchlist.", Type.Object({ watchlist: { $ref: "Watchlist" } as never })),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Watchlist not found or not owned by caller."),
		},
	}),
	requireApiKey,
	tbCoerce("param", IdParam),
	tbBody(WatchlistUpdateRequest),
	async (c) => {
		const key = c.var.apiKey;
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const [row] = await db
			.update(watchlists)
			.set({
				...(body.name !== undefined ? { name: body.name } : {}),
				...(body.criteria !== undefined ? { criteria: body.criteria } : {}),
				...(body.cadence !== undefined ? { cadence: body.cadence } : {}),
				...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
				updatedAt: new Date(),
			})
			.where(and(eq(watchlists.id, id), eq(watchlists.apiKeyId, key.id)))
			.returning();
		if (!row) return c.json({ error: "not_found" as const, message: `watchlist ${id} not found` }, 404);
		return c.json({ watchlist: toDto(row) });
	},
);

watchlistsRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Overnight"],
		summary: "Remove a watchlist (cascades pending deal_queue rows)",
		parameters: paramsFor("path", IdParam),
		responses: {
			204: { description: "Removed." },
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Watchlist not found or not owned by caller."),
		},
	}),
	requireApiKey,
	tbCoerce("param", IdParam),
	async (c) => {
		const key = c.var.apiKey;
		const { id } = c.req.valid("param");
		const result = await db
			.delete(watchlists)
			.where(and(eq(watchlists.id, id), eq(watchlists.apiKeyId, key.id)))
			.returning({ id: watchlists.id });
		if (result.length === 0) {
			return c.json({ error: "not_found" as const, message: `watchlist ${id} not found` }, 404);
		}
		return c.body(null, 204);
	},
);

watchlistsRoute.post(
	"/:id/run-now",
	describeRoute({
		tags: ["Overnight"],
		summary: "Manually trigger a scan for this watchlist",
		description:
			"Synchronous: runs Discover with the saved criteria, snapshots qualifying deals into `/v1/queue`, returns the resulting count. Use sparingly — the scheduler picks up due watchlists automatically.",
		parameters: paramsFor("path", IdParam),
		responses: {
			200: jsonResponse(
				"Scan result.",
				Type.Object({
					queued: Type.Integer(),
					ranAt: Type.String({ format: "date-time" }),
				}),
			),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Watchlist not found or not owned by caller."),
		},
	}),
	requireApiKey,
	tbCoerce("param", IdParam),
	async (c) => {
		const key = c.var.apiKey;
		const { id } = c.req.valid("param");
		const [row] = await db
			.select()
			.from(watchlists)
			.where(and(eq(watchlists.id, id), eq(watchlists.apiKeyId, key.id)))
			.limit(1);
		if (!row) return c.json({ error: "not_found" as const, message: `watchlist ${id} not found` }, 404);
		const result = await runWatchlistScan(row);
		return c.json({ queued: result.queued, ranAt: new Date().toISOString() });
	},
);
