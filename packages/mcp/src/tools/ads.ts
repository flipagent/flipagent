/**
 * Promoted-Listings tools — campaign / group / report. Backed by
 * `/v1/ads/*`. The seller must pass `flipagent_seller_advertising_eligibility`
 * before any of the create tools will succeed.
 */

import { AdCampaignCreate, AdGroupCreate, ReportTaskCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_ads_campaigns_list ---------------------- */

export const adsCampaignsListInput = Type.Object({});
export const adsCampaignsListDescription =
	"List Promoted-Listings campaigns. GET /v1/ads. Each row has `id`, `status`, `budget`, `funding model` (PRIORITY_LISTING|GENERAL|OFFSITE).";
export async function adsCampaignsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.listCampaigns();
	} catch (err) {
		const e = toApiCallError(err, "/v1/ads");
		return { error: "ads_campaigns_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ---------------------- flipagent_ads_campaigns_create --------------------- */

export { AdCampaignCreate as adsCampaignsCreateInput };
export const adsCampaignsCreateDescription =
	"Create a Promoted-Listings campaign. POST /v1/ads. Required: name, funding model, dates, budget. Use after `flipagent_seller_advertising_eligibility` confirms the channel.";
export async function adsCampaignsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.createCampaign(args as Parameters<typeof client.ads.createCampaign>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/ads");
		return { error: "ads_campaigns_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------- flipagent_ads_ads_list -------------------------- */

export const adsAdsListInput = Type.Object({ campaignId: Type.String({ minLength: 1 }) });
export const adsAdsListDescription =
	"List the individual ads (per-listing entries) inside one campaign. GET /v1/ads/{campaignId}/ads.";
export async function adsAdsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const campaignId = String(args.campaignId);
	try {
		const client = getClient(config);
		return await client.ads.listAds(campaignId);
	} catch (err) {
		const e = toApiCallError(err, `/v1/ads/${campaignId}/ads`);
		return { error: "ads_ads_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_ads_groups_list ------------------------ */

export const adsGroupsListInput = Type.Object({ campaignId: Type.String({ minLength: 1 }) });
export const adsGroupsListDescription = "List ad groups in one campaign. GET /v1/ads/{campaignId}/groups.";
export async function adsGroupsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const campaignId = String(args.campaignId);
	try {
		const client = getClient(config);
		return await client.ads.listGroups(campaignId);
	} catch (err) {
		const e = toApiCallError(err, `/v1/ads/${campaignId}/groups`);
		return { error: "ads_groups_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_ads_groups_create ----------------------- */

export const adsGroupsCreateInput = Type.Composite([
	Type.Object({ campaignId: Type.String({ minLength: 1 }) }),
	AdGroupCreate,
]);
export const adsGroupsCreateDescription =
	"Add an ad group to a campaign. POST /v1/ads/{campaignId}/groups. Body shape per `AdGroupCreate` (rules, bid, listings).";
export async function adsGroupsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, ...body } = args as { campaignId: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.ads.createGroup(campaignId, body as Parameters<typeof client.ads.createGroup>[1]);
	} catch (err) {
		const e = toApiCallError(err, `/v1/ads/${campaignId}/groups`);
		return { error: "ads_groups_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_ads_reports_metadata ---------------------- */

export const adsReportsMetadataInput = Type.Object({});
export const adsReportsMetadataDescription =
	"Get the available report dimensions, metrics, date ranges. GET /v1/ads/reports/metadata. Read this before `flipagent_ads_reports_create` to know what to request.";
export async function adsReportsMetadataExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.reportMetadata();
	} catch (err) {
		const e = toApiCallError(err, "/v1/ads/reports/metadata");
		return { error: "ads_reports_metadata_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_ads_reports_list ------------------------ */

export const adsReportsListInput = Type.Object({});
export const adsReportsListDescription = "List queued + completed ads-report tasks. GET /v1/ads/reports/tasks.";
export async function adsReportsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.listReportTasks();
	} catch (err) {
		const e = toApiCallError(err, "/v1/ads/reports/tasks");
		return { error: "ads_reports_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_ads_reports_create ---------------------- */

export { ReportTaskCreate as adsReportsCreateInput };
export const adsReportsCreateDescription =
	"Queue an ads-performance report. POST /v1/ads/reports/tasks. Returns a `ReportTask` with `id` — poll `flipagent_ads_reports_get` until terminal.";
export async function adsReportsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.createReportTask(args as Parameters<typeof client.ads.createReportTask>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/ads/reports/tasks");
		return { error: "ads_reports_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_ads_reports_get ------------------------ */

export const adsReportsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const adsReportsGetDescription = "Poll one ads-report task. GET /v1/ads/reports/tasks/{id}.";
export async function adsReportsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.ads.getReportTask(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/ads/reports/tasks/${id}`);
		return { error: "ads_reports_get_failed", status: e.status, url: e.url, message: e.message };
	}
}
