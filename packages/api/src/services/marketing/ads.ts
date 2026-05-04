/**
 * sell/marketing — promoted-listings ad campaigns + ad groups + ads.
 */

import type { Ad, AdCampaign, AdCampaignCreate, AdGroup, AdGroupCreate, AdsListResponse } from "@flipagent/types";
import { sellRequest, sellRequestWithLocation, swallow404, swallowEbay404 } from "../ebay/rest/user-client.js";
import { toCents, toDollarString } from "../shared/money.js";
import type { MarketingContext } from "./promotions.js";

interface EbayCampaign {
	campaignId: string;
	campaignName: string;
	campaignStatus: string;
	fundingStrategy?: { fundingModel: string };
	startDate?: string;
	endDate?: string;
	budget?: { amount: { value: string; currency: string } };
}

const FUNDING_FROM: Record<string, AdCampaign["fundingModel"]> = {
	NON_PROMOTED: "non_promoted",
	PRIORITY: "priority",
	FLAT_RATE: "flat_rate",
	COST_PER_SALE: "cost_per_sale",
	COST_PER_ACQUISITION: "cost_per_acquisition",
};

function ebayCampaignToFlipagent(c: EbayCampaign): AdCampaign {
	const status = c.campaignStatus.toLowerCase();
	return {
		id: c.campaignId,
		marketplace: "ebay",
		name: c.campaignName,
		status: status === "running" || status === "paused" || status === "ended" ? status : "draft",
		fundingModel: FUNDING_FROM[c.fundingStrategy?.fundingModel ?? "PRIORITY"] ?? "priority",
		...(c.startDate ? { startsAt: c.startDate } : {}),
		...(c.endDate ? { endsAt: c.endDate } : {}),
		...(c.budget ? { budget: { value: toCents(c.budget.amount.value), currency: c.budget.amount.currency } } : {}),
	};
}

export async function listAdCampaigns(
	q: { limit?: number; offset?: number },
	ctx: MarketingContext,
): Promise<AdsListResponse> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	const res = await sellRequest<{ campaigns?: EbayCampaign[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/ad_campaign?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return {
		campaigns: (res?.campaigns ?? []).map(ebayCampaignToFlipagent),
		limit,
		offset,
		source: "rest",
	};
}

export async function createAdCampaign(input: AdCampaignCreate, ctx: MarketingContext): Promise<AdCampaign> {
	const body: Record<string, unknown> = {
		campaignName: input.name,
		// `marketplaceId` is REQUIRED on the ad_campaign body — verified
		// live 2026-05-03 ("The 'marketplaceId' is required."). Same trap
		// as createPromotion / createMarkdown — the marketplace HEADER
		// alone is not enough; the field must be in the JSON body too.
		marketplaceId: ctx.marketplace ?? "EBAY_US",
		fundingStrategy: { fundingModel: input.fundingModel.toUpperCase() },
		...(input.startsAt ? { startDate: input.startsAt } : {}),
		...(input.endsAt ? { endDate: input.endsAt } : {}),
		...(input.budget
			? { budget: { amount: { value: toDollarString(input.budget.value), currency: input.budget.currency } } }
			: {}),
	};
	// `POST /ad_campaign` returns 201 with empty body + Location header
	// containing campaignId. Same pattern as custom_policy / promotions.
	const { body: res, locationId } = await sellRequestWithLocation<{ campaignId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/marketing/v1/ad_campaign",
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.campaignId ?? locationId ?? "",
		marketplace: input.marketplace ?? "ebay",
		name: input.name,
		status: "draft",
		fundingModel: input.fundingModel,
		...(input.startsAt ? { startsAt: input.startsAt } : {}),
		...(input.endsAt ? { endsAt: input.endsAt } : {}),
		...(input.budget ? { budget: input.budget } : {}),
	};
}

export async function listAdsForCampaign(campaignId: string, ctx: MarketingContext): Promise<Ad[]> {
	const res = await sellRequest<{
		ads?: Array<{ adId: string; listingId: string; bidPercentage?: string; adStatus?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return (res?.ads ?? []).map((a) => ({
		id: a.adId,
		campaignId,
		listingId: a.listingId,
		...(a.bidPercentage ? { bidPercentage: a.bidPercentage } : {}),
		status: a.adStatus ?? "ACTIVE",
	}));
}

interface EbayAdGroup {
	adGroupId: string;
	name: string;
	adGroupStatus?: string;
	defaultBid?: { value: string; currency: string };
}

function adGroupFrom(g: EbayAdGroup, campaignId: string): AdGroup {
	const s = g.adGroupStatus?.toLowerCase();
	return {
		id: g.adGroupId,
		campaignId,
		name: g.name,
		// eBay's AdGroup status enum: ACTIVE | PAUSED | ARCHIVED. Previous
		// wrapper used "ended" instead of "archived" — never a real value.
		status: s === "active" || s === "paused" || s === "archived" ? (s as AdGroup["status"]) : "active",
		...(g.defaultBid ? { defaultBid: { value: toCents(g.defaultBid.value), currency: g.defaultBid.currency } } : {}),
	};
}

export async function listAdGroups(campaignId: string, ctx: MarketingContext): Promise<{ groups: AdGroup[] }> {
	const res = await sellRequest<{ adGroups?: EbayAdGroup[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad_group`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return { groups: (res?.adGroups ?? []).map((g) => adGroupFrom(g, campaignId)) };
}

/* ─── campaign lifecycle ─── */

export async function getCampaignByName(name: string, ctx: MarketingContext): Promise<AdCampaign | null> {
	const res = await swallow404(
		sellRequest<EbayCampaign>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/marketing/v1/ad_campaign/get_campaign_by_name?campaign_name=${encodeURIComponent(name)}`,
			marketplace: ctx.marketplace,
		}),
	);
	return res ? ebayCampaignToFlipagent(res) : null;
}

async function campaignAction(campaignId: string, action: string, ctx: MarketingContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/${action}`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export const pauseAdCampaign = (id: string, ctx: MarketingContext) => campaignAction(id, "pause", ctx);
export const resumeAdCampaign = (id: string, ctx: MarketingContext) => campaignAction(id, "resume", ctx);
export const endAdCampaign = (id: string, ctx: MarketingContext) => campaignAction(id, "end", ctx);
export const launchAdCampaign = (id: string, ctx: MarketingContext) => campaignAction(id, "launch", ctx);

export async function cloneAdCampaign(
	campaignId: string,
	newName: string,
	ctx: MarketingContext,
): Promise<{ campaignId: string | null }> {
	// `clone` also returns 201 with Location header carrying the new id.
	const { body: res, locationId } = await sellRequestWithLocation<{ campaignId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/clone`,
		body: { campaignName: newName },
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { campaignId: res?.campaignId ?? locationId ?? null };
}

/* ─── per-ad bid update + bulk ad ops by listingId ─── */

export async function updateAdBid(
	campaignId: string,
	adId: string,
	bidPercentage: string,
	ctx: MarketingContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad/${encodeURIComponent(adId)}/update_bid`,
		body: { bidPercentage },
		marketplace: ctx.marketplace,
	});
}

export interface BulkAdCreateRow {
	listingId: string;
	bidPercentage?: string;
}

export interface BulkAdCreateResponse {
	results: Array<{ listingId: string; adId?: string; status?: string; errors?: unknown }>;
}

export async function bulkCreateAdsByListingId(
	campaignId: string,
	rows: BulkAdCreateRow[],
	ctx: MarketingContext,
): Promise<BulkAdCreateResponse> {
	interface UpstreamRow {
		listingId: string;
		adId?: string;
		statusCode?: number;
		errors?: unknown;
	}
	const res = await sellRequest<{ responses?: UpstreamRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_create_ads_by_listing_id`,
		body: {
			requests: rows.map((r) => ({
				listingId: r.listingId,
				...(r.bidPercentage ? { bidPercentage: r.bidPercentage } : {}),
			})),
		},
		marketplace: ctx.marketplace,
	});
	return {
		results: (res?.responses ?? []).map((r) => ({
			listingId: r.listingId,
			...(r.adId ? { adId: r.adId } : {}),
			...(r.statusCode != null ? { status: String(r.statusCode) } : {}),
			...(r.errors ? { errors: r.errors } : {}),
		})),
	};
}

export interface BulkAdBidUpdateRow {
	listingId: string;
	bidPercentage: string;
}

export async function bulkUpdateAdsBidByListingId(
	campaignId: string,
	rows: BulkAdBidUpdateRow[],
	ctx: MarketingContext,
): Promise<BulkAdCreateResponse> {
	interface UpstreamRow {
		listingId: string;
		statusCode?: number;
		errors?: unknown;
	}
	const res = await sellRequest<{ responses?: UpstreamRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_update_ads_bid_by_listing_id`,
		body: { requests: rows },
		marketplace: ctx.marketplace,
	});
	return {
		results: (res?.responses ?? []).map((r) => ({
			listingId: r.listingId,
			...(r.statusCode != null ? { status: String(r.statusCode) } : {}),
			...(r.errors ? { errors: r.errors } : {}),
		})),
	};
}

export async function bulkDeleteAdsByListingId(
	campaignId: string,
	listingIds: string[],
	ctx: MarketingContext,
): Promise<BulkAdCreateResponse> {
	interface UpstreamRow {
		listingId: string;
		statusCode?: number;
		errors?: unknown;
	}
	const res = await sellRequest<{ responses?: UpstreamRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_delete_ads_by_listing_id`,
		body: { requests: listingIds.map((id) => ({ listingId: id })) },
		marketplace: ctx.marketplace,
	});
	return {
		results: (res?.responses ?? []).map((r) => ({
			listingId: r.listingId,
			...(r.statusCode != null ? { status: String(r.statusCode) } : {}),
			...(r.errors ? { errors: r.errors } : {}),
		})),
	};
}

export interface BulkAdStatusRow {
	listingId: string;
	adStatus: "ACTIVE" | "PAUSED";
}

/* ─── inventory_reference variants (for multi-variation listings) ─── */

export interface BulkAdInventoryRefRow {
	inventoryReferenceId: string;
	inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
	bidPercentage?: string;
}

interface UpstreamInventoryRefResponseRow {
	inventoryReferenceId: string;
	inventoryReferenceType?: string;
	adId?: string;
	statusCode?: number;
	errors?: unknown;
}

export interface BulkAdInventoryRefResponse {
	results: Array<{
		inventoryReferenceId: string;
		inventoryReferenceType: string;
		adId?: string;
		status?: string;
		errors?: unknown;
	}>;
}

function mapInventoryRefRows(rows: UpstreamInventoryRefResponseRow[] | undefined): BulkAdInventoryRefResponse {
	return {
		results: (rows ?? []).map((r) => ({
			inventoryReferenceId: r.inventoryReferenceId,
			inventoryReferenceType: r.inventoryReferenceType ?? "",
			...(r.adId ? { adId: r.adId } : {}),
			...(r.statusCode != null ? { status: String(r.statusCode) } : {}),
			...(r.errors ? { errors: r.errors } : {}),
		})),
	};
}

export async function bulkCreateAdsByInventoryReference(
	campaignId: string,
	rows: BulkAdInventoryRefRow[],
	ctx: MarketingContext,
): Promise<BulkAdInventoryRefResponse> {
	const res = await sellRequest<{ responses?: UpstreamInventoryRefResponseRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_create_ads_by_inventory_reference`,
		body: { requests: rows },
		marketplace: ctx.marketplace,
	});
	return mapInventoryRefRows(res?.responses);
}

export async function bulkUpdateAdsBidByInventoryReference(
	campaignId: string,
	rows: Array<{
		inventoryReferenceId: string;
		inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP";
		bidPercentage: string;
	}>,
	ctx: MarketingContext,
): Promise<BulkAdInventoryRefResponse> {
	const res = await sellRequest<{ responses?: UpstreamInventoryRefResponseRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_update_ads_bid_by_inventory_reference`,
		body: { requests: rows },
		marketplace: ctx.marketplace,
	});
	return mapInventoryRefRows(res?.responses);
}

export async function bulkDeleteAdsByInventoryReference(
	campaignId: string,
	rows: Array<{ inventoryReferenceId: string; inventoryReferenceType: "INVENTORY_ITEM" | "INVENTORY_ITEM_GROUP" }>,
	ctx: MarketingContext,
): Promise<BulkAdInventoryRefResponse> {
	const res = await sellRequest<{ responses?: UpstreamInventoryRefResponseRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_delete_ads_by_inventory_reference`,
		body: { requests: rows },
		marketplace: ctx.marketplace,
	});
	return mapInventoryRefRows(res?.responses);
}

export async function bulkUpdateAdsStatus(
	campaignId: string,
	rows: BulkAdStatusRow[],
	ctx: MarketingContext,
): Promise<BulkAdCreateResponse> {
	interface UpstreamRow {
		listingId: string;
		statusCode?: number;
		errors?: unknown;
	}
	const res = await sellRequest<{ responses?: UpstreamRow[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_update_ads_status_by_listing_id`,
		body: { requests: rows },
		marketplace: ctx.marketplace,
	});
	return {
		results: (res?.responses ?? []).map((r) => ({
			listingId: r.listingId,
			...(r.statusCode != null ? { status: String(r.statusCode) } : {}),
			...(r.errors ? { errors: r.errors } : {}),
		})),
	};
}

export async function createAdGroup(campaignId: string, input: AdGroupCreate, ctx: MarketingContext): Promise<AdGroup> {
	// `CreateAdGroupRequest` per OAS3 spec
	// (`references/ebay-mcp/docs/_mirror/sell_marketing_v1_oas3.json`):
	// only `{ name, defaultBid: Amount }`. Previous wrapper sent
	// `defaultBidPercentage: string` — silently dropped by eBay.
	// `defaultBid` is the per-keyword cost-per-click in CPC campaigns.
	const { body: res, locationId } = await sellRequestWithLocation<{ adGroupId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad_group`,
		body: {
			name: input.name,
			...(input.defaultBid
				? { defaultBid: { value: toDollarString(input.defaultBid.value), currency: input.defaultBid.currency } }
				: {}),
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.adGroupId ?? locationId ?? "",
		campaignId,
		name: input.name,
		status: "active",
		...(input.defaultBid ? { defaultBid: input.defaultBid } : {}),
	};
}
