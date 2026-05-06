/**
 * `/v1/jobs` — cross-surface, cross-kind activity history.
 *
 * Every billable user-initiated operation (evaluate, search) lands in
 * `compute_jobs` regardless of where it was kicked off (extension,
 * playground, MCP, agent, SDK), so this list is the one place to ask
 * "what have I done recently?". Click-through to a per-kind get
 * (`/v1/evaluate/jobs/{id}` etc.) for the full result.
 *
 * Free read; never charged. Lean per-row shape (just enough to render
 * a row) — the heavy result body comes from the per-kind get.
 */

import { type ComputeJobKind, JobListResponse, type JobSummary } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { ComputeJob } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { listJobs } from "../../services/compute-jobs/queue.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const jobsRoute = new Hono();

jobsRoute.get(
	"/",
	describeRoute({
		tags: ["Jobs"],
		summary: "List recent operations (cross-surface, cross-kind history)",
		description:
			"Returns recent compute jobs created by this API key — across every surface (extension, playground, MCP, agent, SDK) and kind (evaluate, search). Lean per-row shape: `{ id, kind, status, label, subLabel?, imageUrl?, createdAt, completedAt }`. Click-through hits per-kind get (`/v1/evaluate/jobs/{id}` etc.) for the full result. Free read; never charged. Filters: `kind=evaluate|search`, `status=...`, `since=<ISO>`, `cursor=<ISO>` (keyset paging — pass the previous page's last `createdAt`), `limit` (default 20, max 100).",
		responses: {
			200: jsonResponse("Recent jobs.", JobListResponse),
			400: errorResponse("Invalid query parameter."),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const kind = c.req.query("kind") as ComputeJobKind | undefined;
		const status = c.req.query("status") as ComputeJob["status"] | undefined;
		const sinceRaw = c.req.query("since");
		const cursorRaw = c.req.query("cursor");
		const limitRaw = c.req.query("limit");

		const since = sinceRaw ? new Date(sinceRaw) : undefined;
		const cursor = cursorRaw ? new Date(cursorRaw) : undefined;
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;

		if (since && Number.isNaN(since.getTime())) {
			return c.json({ error: "invalid_since", message: "since must be ISO 8601." }, 400);
		}
		if (cursor && Number.isNaN(cursor.getTime())) {
			return c.json({ error: "invalid_cursor", message: "cursor must be ISO 8601." }, 400);
		}
		if (Number.isNaN(limit) || limit < 1) {
			return c.json({ error: "invalid_limit", message: "limit must be a positive integer ≤ 100." }, 400);
		}

		const rows = await listJobs({
			apiKeyId: c.var.apiKey.id,
			kind,
			status,
			since,
			cursor,
			limit,
		});

		const items = rows.map(toJobSummary);
		const cap = Math.min(Math.max(limit, 1), 100);
		const nextCursor = rows.length === cap ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
		return c.json({ items, cursor: nextCursor });
	},
);

/**
 * Per-kind row → row-summary projection. Kept local to the route
 * because the projection rules are UI-shaped (label/subLabel pre-
 * rendered) and shouldn't leak into the queue helper.
 */
function toJobSummary(job: ComputeJob): JobSummary {
	const base = {
		id: job.id,
		status: job.status,
		params: job.params,
		errorCode: job.errorCode ?? null,
		createdAt: job.createdAt.toISOString(),
		completedAt: job.completedAt?.toISOString() ?? null,
	};
	if (job.kind === "evaluate") {
		const params = job.params as { itemId?: string };
		const result = job.result as null | {
			item?: { title?: string; image?: { imageUrl?: string } };
			evaluation?: { rating?: "buy" | "skip" };
		};
		return {
			...base,
			kind: "evaluate",
			label: result?.item?.title ?? params.itemId ?? job.id,
			...(result?.evaluation?.rating ? { subLabel: result.evaluation.rating } : {}),
			...(result?.item?.image?.imageUrl ? { imageUrl: result.item.image.imageUrl } : {}),
		};
	}
	const params = job.params as { q?: string; categoryId?: string; status?: string };
	const result = job.result as null | { items?: ReadonlyArray<unknown>; total?: number };
	const label = params.q?.trim() || (params.categoryId ? `category:${params.categoryId}` : job.id);
	const count = result?.items?.length ?? result?.total;
	return {
		...base,
		kind: "search",
		label,
		...(count !== undefined ? { subLabel: `${count} ${params.status === "sold" ? "sold" : "active"}` } : {}),
	};
}
