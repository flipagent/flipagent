/**
 * `client.ads.*` — promoted-listings campaigns, ad groups, reports.
 */

import type {
	AdCampaign,
	AdCampaignCreate,
	AdGroup,
	AdGroupCreate,
	AdGroupsListResponse,
	AdsListResponse,
	ReportMetadata,
	ReportTask,
	ReportTaskCreate,
	ReportTasksListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface AdsClient {
	listCampaigns(): Promise<AdsListResponse>;
	createCampaign(body: AdCampaignCreate): Promise<AdCampaign>;
	listAds(campaignId: string): Promise<unknown>;
	listGroups(campaignId: string): Promise<AdGroupsListResponse>;
	createGroup(campaignId: string, body: AdGroupCreate): Promise<AdGroup>;
	reportMetadata(): Promise<ReportMetadata>;
	listReportTasks(): Promise<ReportTasksListResponse>;
	createReportTask(body: ReportTaskCreate): Promise<ReportTask>;
	getReportTask(id: string): Promise<ReportTask>;
}

export function createAdsClient(http: FlipagentHttp): AdsClient {
	return {
		listCampaigns: () => http.get("/v1/ads"),
		createCampaign: (body) => http.post("/v1/ads", body),
		listAds: (campaignId) => http.get(`/v1/ads/${encodeURIComponent(campaignId)}/ads`),
		listGroups: (campaignId) => http.get(`/v1/ads/${encodeURIComponent(campaignId)}/groups`),
		createGroup: (campaignId, body) => http.post(`/v1/ads/${encodeURIComponent(campaignId)}/groups`, body),
		reportMetadata: () => http.get("/v1/ads/reports/metadata"),
		listReportTasks: () => http.get("/v1/ads/reports/tasks"),
		createReportTask: (body) => http.post("/v1/ads/reports/tasks", body),
		getReportTask: (id) => http.get(`/v1/ads/reports/tasks/${encodeURIComponent(id)}`),
	};
}
