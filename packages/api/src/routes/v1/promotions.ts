/**
 * `/v1/promotions/*` — item promotions + summary report tasks.
 */

import {
	PromotionCreate,
	PromotionsListResponse,
	ReportTask,
	ReportTaskCreate,
	ReportTasksListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	createPromotion,
	deletePromotion,
	getPromotion,
	getPromotionListingSet,
	listPromotions,
	pausePromotion,
	resumePromotion,
	updatePromotion,
} from "../../services/marketing/promotions.js";
import { createReportTask, getReportTask, listReportTasks } from "../../services/marketing/reports.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const promotionsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

promotionsRoute.get(
	"/",
	describeRoute({
		tags: ["Promotions"],
		summary: "List item promotions",
		responses: { 200: jsonResponse("Promotions.", PromotionsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await listPromotions(
			{ limit: Number(c.req.query("limit") ?? 50), offset: Number(c.req.query("offset") ?? 0) },
			{
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			},
		);
		return c.json({ ...r, source: "rest" as const });
	},
);

promotionsRoute.post(
	"/",
	describeRoute({
		tags: ["Promotions"],
		summary: "Create an item promotion",
		responses: { 201: jsonResponse("Created.", PromotionCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(PromotionCreate),
	async (c) => {
		const r = await createPromotion(c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json(r, 201);
	},
);

promotionsRoute.get(
	"/:id",
	describeRoute({
		tags: ["Promotions"],
		summary: "Get a promotion by id",
		responses: { 200: { description: "Promotion." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getPromotion(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!r) return c.json({ error: "promotion_not_found" }, 404);
		return c.json({ ...r, source: "rest" as const });
	},
);

promotionsRoute.put(
	"/:id",
	describeRoute({
		tags: ["Promotions"],
		summary: "Update a promotion",
		responses: { 200: { description: "Updated." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(PromotionCreate),
	async (c) => {
		const r = await updatePromotion(c.req.param("id"), c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r, source: "rest" as const });
	},
);

promotionsRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Promotions"],
		summary: "Delete a promotion",
		responses: { 200: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deletePromotion(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ok: true, source: "rest" as const });
	},
);

promotionsRoute.post(
	"/:id/pause",
	describeRoute({
		tags: ["Promotions"],
		summary: "Pause a running promotion",
		responses: { 200: { description: "Paused." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await pausePromotion(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ok: true, source: "rest" as const });
	},
);

promotionsRoute.post(
	"/:id/resume",
	describeRoute({
		tags: ["Promotions"],
		summary: "Resume a paused promotion",
		responses: { 200: { description: "Resumed." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await resumePromotion(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ok: true, source: "rest" as const });
	},
);

promotionsRoute.get(
	"/:id/listings",
	describeRoute({
		tags: ["Promotions"],
		summary: "List the listing IDs participating in a promotion",
		responses: { 200: { description: "Listings." }, ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getPromotionListingSet(c.req.param("id"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
			source: "rest" as const,
		}),
);

/* ----- /v1/promotions/reports ---------------------------------------- */

promotionsRoute.get(
	"/reports",
	describeRoute({
		tags: ["Promotions"],
		summary: "List promotion summary report tasks",
		responses: { 200: jsonResponse("Tasks.", ReportTasksListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listReportTasks("promotion_summary", { apiKeyId: c.var.apiKey.id })),
			source: "rest" as const,
		}),
);

promotionsRoute.post(
	"/reports",
	describeRoute({
		tags: ["Promotions"],
		summary: "Create promotion summary report task",
		responses: { 201: jsonResponse("Created.", ReportTaskCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(ReportTaskCreate),
	async (c) =>
		c.json(
			await createReportTask(
				{ ...c.req.valid("json"), kind: "promotion_summary" },
				{
					apiKeyId: c.var.apiKey.id,
					marketplace: ebayMarketplaceId(),
				},
			),
			201,
		),
);

promotionsRoute.get(
	"/reports/:id",
	describeRoute({
		tags: ["Promotions"],
		summary: "Get a promotion summary report task",
		responses: { 200: jsonResponse("Task.", ReportTask), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getReportTask(c.req.param("id"), "promotion_summary", { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "report_not_found" }, 404);
		return c.json(r);
	},
);
