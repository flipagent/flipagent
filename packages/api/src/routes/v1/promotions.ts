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
import { createPromotion, listPromotions } from "../../services/marketing/promotions.js";
import { createReportTask, getReportTask, listReportTasks } from "../../services/marketing/reports.js";
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
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
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
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json(r, 201);
	},
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
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
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
