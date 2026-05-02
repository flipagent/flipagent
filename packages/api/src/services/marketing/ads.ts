/**
 * sell/marketing — promoted-listings ad campaigns + ad groups + ads.
 */

import type { Ad, AdCampaign, AdCampaignCreate, AdGroup, AdGroupCreate, AdsListResponse } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";
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
	}).catch(() => null);
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
		fundingStrategy: { fundingModel: input.fundingModel.toUpperCase() },
		...(input.startsAt ? { startDate: input.startsAt } : {}),
		...(input.endsAt ? { endDate: input.endsAt } : {}),
		...(input.budget
			? { budget: { amount: { value: toDollarString(input.budget.value), currency: input.budget.currency } } }
			: {}),
	};
	const res = await sellRequest<{ campaignId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/marketing/v1/ad_campaign",
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.campaignId ?? "",
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
	}).catch(() => null);
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
	defaultBidPercentage?: string;
}

function adGroupFrom(g: EbayAdGroup, campaignId: string): AdGroup {
	const s = g.adGroupStatus?.toLowerCase();
	return {
		id: g.adGroupId,
		campaignId,
		name: g.name,
		status: s === "active" || s === "paused" || s === "ended" ? (s as AdGroup["status"]) : "active",
		...(g.defaultBidPercentage ? { defaultBidPercentage: g.defaultBidPercentage } : {}),
	};
}

export async function listAdGroups(campaignId: string, ctx: MarketingContext): Promise<{ groups: AdGroup[] }> {
	const res = await sellRequest<{ adGroups?: EbayAdGroup[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad_group`,
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return { groups: (res?.adGroups ?? []).map((g) => adGroupFrom(g, campaignId)) };
}

export async function createAdGroup(campaignId: string, input: AdGroupCreate, ctx: MarketingContext): Promise<AdGroup> {
	const res = await sellRequest<{ adGroupId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad_group`,
		body: {
			name: input.name,
			...(input.defaultBidPercentage ? { defaultBidPercentage: input.defaultBidPercentage } : {}),
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.adGroupId ?? "",
		campaignId,
		name: input.name,
		status: "active",
		...(input.defaultBidPercentage ? { defaultBidPercentage: input.defaultBidPercentage } : {}),
	};
}
