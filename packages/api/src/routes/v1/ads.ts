/**
 * `/v1/ads/*` — promoted-listings campaigns, ad groups, reports.
 */

import {
	AdBidUpdateRequest,
	AdCampaignCloneRequest,
	AdCampaignCreate,
	AdGroupCreate,
	AdGroupsListResponse,
	AdsListResponse,
	BulkAdsByListingDeleteRequest,
	BulkAdsByListingRequest,
	BulkAdsResponse,
	BulkAdsStatusRequest,
	ReportMetadata,
	ReportTask,
	ReportTaskCreate,
	ReportTasksListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	bulkCreateAdsByInventoryReference,
	bulkCreateAdsByListingId,
	bulkDeleteAdsByInventoryReference,
	bulkDeleteAdsByListingId,
	bulkUpdateAdsBidByInventoryReference,
	bulkUpdateAdsBidByListingId,
	bulkUpdateAdsStatus,
	cloneAdCampaign,
	createAdCampaign,
	createAdGroup,
	endAdCampaign,
	getCampaignByName,
	listAdCampaigns,
	listAdGroups,
	listAdsForCampaign,
	pauseAdCampaign,
	resumeAdCampaign,
	updateAdBid,
} from "../../services/marketing/ads.js";
import {
	createReportTask,
	downloadAdReport,
	getReportMetadata,
	getReportTask,
	listReportTasks,
} from "../../services/marketing/reports.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
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
				marketplace: ebayMarketplaceId(),
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
			marketplace: ebayMarketplaceId(),
		});
		return c.json(r, 201);
	},
);

adsRoute.get(
	"/by-name",
	describeRoute({
		tags: ["Ads"],
		summary: "Get ad campaign by name",
		responses: { 200: { description: "Campaign." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const name = c.req.query("name");
		if (!name) return c.json({ error: "missing_name", message: "?name= is required." }, 400);
		const r = await getCampaignByName(name, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!r) return c.json({ error: "campaign_not_found" }, 404);
		return c.json({ ...r });
	},
);

adsRoute.post(
	"/:campaignId/pause",
	describeRoute({
		tags: ["Ads"],
		summary: "Pause an active campaign",
		responses: { 204: { description: "Paused." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await pauseAdCampaign(c.req.param("campaignId"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.body(null, 204);
	},
);

adsRoute.post(
	"/:campaignId/resume",
	describeRoute({
		tags: ["Ads"],
		summary: "Resume a paused campaign",
		responses: { 204: { description: "Resumed." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await resumeAdCampaign(c.req.param("campaignId"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.body(null, 204);
	},
);

adsRoute.post(
	"/:campaignId/end",
	describeRoute({
		tags: ["Ads"],
		summary: "End (terminal) a campaign",
		responses: { 204: { description: "Ended." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await endAdCampaign(c.req.param("campaignId"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.body(null, 204);
	},
);

adsRoute.post(
	"/:campaignId/clone",
	describeRoute({
		tags: ["Ads"],
		summary: "Clone a campaign under a new name",
		responses: { 201: { description: "Created." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(AdCampaignCloneRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await cloneAdCampaign(c.req.param("campaignId"), body.name, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r }, 201);
	},
);

adsRoute.post(
	"/:campaignId/ads/:adId/bid",
	describeRoute({
		tags: ["Ads"],
		summary: "Update one ad's bid percentage",
		responses: { 204: { description: "Updated." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(AdBidUpdateRequest),
	async (c) => {
		const body = c.req.valid("json");
		await updateAdBid(c.req.param("campaignId"), c.req.param("adId"), body.bidPercentage, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.body(null, 204);
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-create",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk-create ads by listing id (up to 500)",
		responses: { 200: jsonResponse("Per-row result.", BulkAdsResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(BulkAdsByListingRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await bulkCreateAdsByListingId(c.req.param("campaignId"), body.requests, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-update-bid",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk-update ad bids by listing id",
		responses: { 200: jsonResponse("Per-row result.", BulkAdsResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(BulkAdsByListingRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await bulkUpdateAdsBidByListingId(
			c.req.param("campaignId"),
			body.requests.map((row) => ({ listingId: row.listingId, bidPercentage: row.bidPercentage ?? "" })),
			{ apiKeyId: c.var.apiKey.id, marketplace: ebayMarketplaceId() },
		);
		return c.json({ ...r });
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-delete",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk-delete ads by listing id",
		responses: { 200: jsonResponse("Per-row result.", BulkAdsResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(BulkAdsByListingDeleteRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await bulkDeleteAdsByListingId(c.req.param("campaignId"), body.listingIds, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-create-by-inventory-reference",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk-create ads by inventory_reference (multi-variation listings)",
		description:
			"Variant of bulk-create that targets `inventoryReferenceId` + `inventoryReferenceType` (`INVENTORY_ITEM` | `INVENTORY_ITEM_GROUP`) instead of `listingId`. Use when listings are organized as inventory_item_groups (size/color matrices) and you want to ad an entire variation set in one go.",
		responses: { 200: { description: "Per-row result." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as {
			requests: Array<{
				inventoryReferenceId: string;
				inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
				bidPercentage?: string;
			}>;
		};
		const r = await bulkCreateAdsByInventoryReference(c.req.param("campaignId"), body.requests, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-update-bid-by-inventory-reference",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk-update ad bids by inventory_reference",
		responses: { 200: { description: "Per-row result." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as {
			requests: Array<{
				inventoryReferenceId: string;
				inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
				bidPercentage: string;
			}>;
		};
		const r = await bulkUpdateAdsBidByInventoryReference(c.req.param("campaignId"), body.requests, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-delete-by-inventory-reference",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk-delete ads by inventory_reference",
		responses: { 200: { description: "Per-row result." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as {
			requests: Array<{
				inventoryReferenceId: string;
				inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
			}>;
		};
		const r = await bulkDeleteAdsByInventoryReference(c.req.param("campaignId"), body.requests, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

adsRoute.get(
	"/reports/:reportId/download",
	describeRoute({
		tags: ["Ads"],
		summary: "Download a completed ad report (TSV)",
		description:
			"Streams the raw TSV report. Call after `flipagent_get_ad_report` shows status=completed. eBay enforces 200 calls/hour per user on this endpoint.",
		responses: { 200: { description: "TSV bytes." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const { data, contentType } = await downloadAdReport(c.req.param("reportId"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.body(new Uint8Array(data), 200, { "Content-Type": contentType });
	},
);

adsRoute.post(
	"/:campaignId/ads/bulk-update-status",
	describeRoute({
		tags: ["Ads"],
		summary: "Bulk pause/resume ads by listing id",
		responses: { 200: jsonResponse("Per-row result.", BulkAdsResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(BulkAdsStatusRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await bulkUpdateAdsStatus(c.req.param("campaignId"), body.requests, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
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
	async (c) => c.json({ ...(await getReportMetadata({ apiKeyId: c.var.apiKey.id })) }),
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
				marketplace: ebayMarketplaceId(),
			})),
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
					marketplace: ebayMarketplaceId(),
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
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ads });
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
				marketplace: ebayMarketplaceId(),
			})),
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
				marketplace: ebayMarketplaceId(),
			}),
			201,
		),
);
