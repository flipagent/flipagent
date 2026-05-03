/**
 * `client.ads.*` — promoted-listings campaigns, ad groups, reports.
 */

import type {
	AdBidUpdateRequest,
	AdCampaign,
	AdCampaignCloneRequest,
	AdCampaignCreate,
	AdGroup,
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
import type { FlipagentHttp } from "./http.js";

export interface AdsClient {
	listCampaigns(): Promise<AdsListResponse>;
	createCampaign(body: AdCampaignCreate): Promise<AdCampaign>;
	getCampaignByName(name: string): Promise<AdCampaign>;
	pauseCampaign(campaignId: string): Promise<void>;
	resumeCampaign(campaignId: string): Promise<void>;
	endCampaign(campaignId: string): Promise<void>;
	cloneCampaign(campaignId: string, body: AdCampaignCloneRequest): Promise<{ campaignId: string | null }>;
	listAds(campaignId: string): Promise<unknown>;
	updateAdBid(campaignId: string, adId: string, body: AdBidUpdateRequest): Promise<void>;
	bulkCreateAds(campaignId: string, body: BulkAdsByListingRequest): Promise<BulkAdsResponse>;
	bulkUpdateAdBids(campaignId: string, body: BulkAdsByListingRequest): Promise<BulkAdsResponse>;
	bulkDeleteAds(campaignId: string, body: BulkAdsByListingDeleteRequest): Promise<BulkAdsResponse>;
	bulkUpdateAdStatus(campaignId: string, body: BulkAdsStatusRequest): Promise<BulkAdsResponse>;
	bulkCreateAdsByInventoryRef(
		campaignId: string,
		body: {
			requests: Array<{
				inventoryReferenceId: string;
				inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
				bidPercentage?: string;
			}>;
		},
	): Promise<unknown>;
	bulkUpdateAdBidsByInventoryRef(
		campaignId: string,
		body: {
			requests: Array<{
				inventoryReferenceId: string;
				inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
				bidPercentage: string;
			}>;
		},
	): Promise<unknown>;
	bulkDeleteAdsByInventoryRef(
		campaignId: string,
		body: {
			requests: Array<{
				inventoryReferenceId: string;
				inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
			}>;
		},
	): Promise<unknown>;
	downloadReport(reportId: string): Promise<Response>;
	listGroups(campaignId: string): Promise<AdGroupsListResponse>;
	createGroup(campaignId: string, body: AdGroupCreate): Promise<AdGroup>;
	reportMetadata(): Promise<ReportMetadata>;
	listReportTasks(): Promise<ReportTasksListResponse>;
	createReportTask(body: ReportTaskCreate): Promise<ReportTask>;
	getReportTask(id: string): Promise<ReportTask>;
}

export function createAdsClient(http: FlipagentHttp): AdsClient {
	const c = (id: string) => `/v1/ads/${encodeURIComponent(id)}`;
	return {
		listCampaigns: () => http.get("/v1/ads"),
		createCampaign: (body) => http.post("/v1/ads", body),
		getCampaignByName: (name) => http.get("/v1/ads/by-name", { name }),
		pauseCampaign: (id) => http.post(`${c(id)}/pause`),
		resumeCampaign: (id) => http.post(`${c(id)}/resume`),
		endCampaign: (id) => http.post(`${c(id)}/end`),
		cloneCampaign: (id, body) => http.post(`${c(id)}/clone`, body),
		listAds: (id) => http.get(`${c(id)}/ads`),
		updateAdBid: (id, adId, body) => http.post(`${c(id)}/ads/${encodeURIComponent(adId)}/bid`, body),
		bulkCreateAds: (id, body) => http.post(`${c(id)}/ads/bulk-create`, body),
		bulkUpdateAdBids: (id, body) => http.post(`${c(id)}/ads/bulk-update-bid`, body),
		bulkDeleteAds: (id, body) => http.post(`${c(id)}/ads/bulk-delete`, body),
		bulkUpdateAdStatus: (id, body) => http.post(`${c(id)}/ads/bulk-update-status`, body),
		bulkCreateAdsByInventoryRef: (id, body) => http.post(`${c(id)}/ads/bulk-create-by-inventory-reference`, body),
		bulkUpdateAdBidsByInventoryRef: (id, body) =>
			http.post(`${c(id)}/ads/bulk-update-bid-by-inventory-reference`, body),
		bulkDeleteAdsByInventoryRef: (id, body) => http.post(`${c(id)}/ads/bulk-delete-by-inventory-reference`, body),
		downloadReport: (reportId) => http.fetchRaw(`/v1/ads/reports/${encodeURIComponent(reportId)}/download`),
		listGroups: (id) => http.get(`${c(id)}/groups`),
		createGroup: (id, body) => http.post(`${c(id)}/groups`, body),
		reportMetadata: () => http.get("/v1/ads/reports/metadata"),
		listReportTasks: () => http.get("/v1/ads/reports/tasks"),
		createReportTask: (body) => http.post("/v1/ads/reports/tasks", body),
		getReportTask: (id) => http.get(`/v1/ads/reports/tasks/${encodeURIComponent(id)}`),
	};
}
