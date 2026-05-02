/**
 * `/v1/ads/*` — promoted-listings campaigns, ad groups, reports.
 */

import {
	AdCampaignCreate,
	AdGroupCreate,
	AdGroupsListResponse,
	AdsListResponse,
	ReportMetadata,
	ReportTask,
	ReportTaskCreate,
	ReportTasksListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	createAdCampaign,
	createAdGroup,
	listAdCampaigns,
	listAdGroups,
	listAdsForCampaign,
} from "../../services/marketing/ads.js";
import {
	createReportTask,
	getReportMetadata,
	getReportTask,
	listReportTasks,
} from "../../services/marketing/reports.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const adsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

/* ----- /v1/ads ------------------------------------------------------- */

adsRoute.get(
	"/",
	describeRoute({
		tags: ["Ads"],
		summary: "List ad campaigns",
		responses: { 200: jsonResponse("Campaigns.", AdsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await listAdCampaigns(
			{ limit: Number(c.req.query("limit") ?? 50), offset: Number(c.req.query("offset") ?? 0) },
			{
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			},
		);
		return c.json(r);
	},
);

adsRoute.post(
	"/",
	describeRoute({
		tags: ["Ads"],
		summary: "Create ad campaign",
		responses: { 201: jsonResponse("Created.", AdCampaignCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(AdCampaignCreate),
	async (c) => {
		const r = await createAdCampaign(c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json(r, 201);
	},
);

/* ----- /v1/ads/reports ----------------------------------------------- */

adsRoute.get(
	"/reports/metadata",
	describeRoute({
		tags: ["Ads"],
		summary: "Available report dimensions + metrics",
		responses: { 200: jsonResponse("Metadata.", ReportMetadata), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getReportMetadata({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

adsRoute.get(
	"/reports/tasks",
	describeRoute({
		tags: ["Ads"],
		summary: "List ad report tasks",
		responses: { 200: jsonResponse("Tasks.", ReportTasksListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listReportTasks("ad", {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
		}),
);

adsRoute.post(
	"/reports/tasks",
	describeRoute({
		tags: ["Ads"],
		summary: "Create an ad report task",
		responses: { 201: jsonResponse("Created.", ReportTaskCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(ReportTaskCreate),
	async (c) =>
		c.json(
			await createReportTask(
				{ ...c.req.valid("json"), kind: "ad" },
				{
					apiKeyId: c.var.apiKey.id,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
				},
			),
			201,
		),
);

adsRoute.get(
	"/reports/tasks/:id",
	describeRoute({
		tags: ["Ads"],
		summary: "Get an ad report task",
		responses: { 200: jsonResponse("Task.", ReportTask), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getReportTask(c.req.param("id"), "ad", { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "report_not_found" }, 404);
		return c.json(r);
	},
);

/* ----- /v1/ads/{campaignId}/ads + /groups ---------------------------- */

adsRoute.get(
	"/:campaignId/ads",
	describeRoute({
		tags: ["Ads"],
		summary: "List ads in a campaign",
		responses: { 200: { description: "Ads." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const ads = await listAdsForCampaign(c.req.param("campaignId"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({ ads, source: "rest" as const });
	},
);

adsRoute.get(
	"/:campaignId/groups",
	describeRoute({
		tags: ["Ads"],
		summary: "List ad groups in a campaign",
		responses: { 200: jsonResponse("Groups.", AdGroupsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listAdGroups(c.req.param("campaignId"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
		}),
);

adsRoute.post(
	"/:campaignId/groups",
	describeRoute({
		tags: ["Ads"],
		summary: "Create an ad group in a campaign",
		responses: { 201: jsonResponse("Created.", AdGroupCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(AdGroupCreate),
	async (c) =>
		c.json(
			await createAdGroup(c.req.param("campaignId"), c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			}),
			201,
		),
);
