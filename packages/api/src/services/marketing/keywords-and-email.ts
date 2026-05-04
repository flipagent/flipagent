/**
 * sell/marketing/v1 — keyword + negative_keyword + email_campaign.
 *
 * Niche advanced PPC + email-blast surfaces. Wrapped here for
 * completeness; flipagent's typical reseller-automation use case
 * doesn't run keyword bidding manually.
 */

import { sellRequest, sellRequestWithLocation } from "../ebay/rest/user-client.js";

export interface KwContext {
	apiKeyId: string;
	marketplace?: string;
}

const ROOT = "/sell/marketing/v1";

/* ============================================================ Per-campaign keywords (PLA) */

export async function listCampaignKeywords(
	campaignId: string,
	q: Record<string, string> = {},
	ctx: KwContext,
): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/keyword?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function createCampaignKeyword(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ keywordId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/keyword`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id: res?.keywordId ?? locationId ?? "" };
}
export async function getCampaignKeyword(campaignId: string, keywordId: string, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/keyword/${encodeURIComponent(keywordId)}`,
		marketplace: ctx.marketplace,
	});
}
export async function updateCampaignKeyword(
	campaignId: string,
	keywordId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/keyword/${encodeURIComponent(keywordId)}`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function bulkCreateCampaignKeywords(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/bulk_create_keyword`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function bulkUpdateCampaignKeywords(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/bulk_update_keyword`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function suggestKeywords(
	campaignId: string,
	adGroupId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/ad_group/${encodeURIComponent(adGroupId)}/suggest_keywords`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function suggestBids(
	campaignId: string,
	adGroupId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/ad_group/${encodeURIComponent(adGroupId)}/suggest_bids`,
		body,
		marketplace: ctx.marketplace,
	});
}

/* ============================================================ Negative keywords (account-level) */

export async function listNegativeKeywords(q: Record<string, string> = {}, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/negative_keyword?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function createNegativeKeyword(body: Record<string, unknown>, ctx: KwContext): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ negativeKeywordId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/negative_keyword`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id: res?.negativeKeywordId ?? locationId ?? "" };
}
export async function getNegativeKeyword(id: string, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/negative_keyword/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}
export async function updateNegativeKeyword(id: string, body: Record<string, unknown>, ctx: KwContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `${ROOT}/negative_keyword/${encodeURIComponent(id)}`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function bulkCreateNegativeKeywords(body: Record<string, unknown>, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/bulk_create_negative_keyword`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function bulkUpdateNegativeKeywords(body: Record<string, unknown>, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/bulk_update_negative_keyword`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}

/* ============================================================ Email campaign */

export async function listEmailCampaigns(q: Record<string, string> = {}, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/email_campaign?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function createEmailCampaign(body: Record<string, unknown>, ctx: KwContext): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ campaignId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/email_campaign`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id: res?.campaignId ?? locationId ?? "" };
}
export async function getEmailCampaign(id: string, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/email_campaign/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}
export async function updateEmailCampaign(id: string, body: Record<string, unknown>, ctx: KwContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `${ROOT}/email_campaign/${encodeURIComponent(id)}`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function deleteEmailCampaign(id: string, ctx: KwContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `${ROOT}/email_campaign/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}
export async function previewEmailCampaign(id: string, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/email_campaign/${encodeURIComponent(id)}/email_preview`,
		marketplace: ctx.marketplace,
	});
}
export async function getEmailCampaignAudience(q: Record<string, string> = {}, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/email_campaign/audience?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function getEmailCampaignReport(q: Record<string, string> = {}, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/email_campaign/report?${params}`,
		marketplace: ctx.marketplace,
	});
}

/* ============================================================ Misc niche additions */

export async function findCampaignByAdReference(q: Record<string, string>, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_campaign/find_campaign_by_ad_reference?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function setupQuickCampaign(body: Record<string, unknown>, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/setup_quick_campaign`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
}
export async function suggestBudget(q: Record<string, string>, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_campaign/suggest_budget?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function suggestMaxCpc(body: Record<string, unknown>, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/suggest_max_cpc`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function suggestCampaignItems(
	campaignId: string,
	q: Record<string, string> = {},
	ctx: KwContext,
): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/suggest_items?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function updateAdRateStrategy(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/update_ad_rate_strategy`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function updateBiddingStrategy(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/update_bidding_strategy`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function updateCampaignBudget(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/update_campaign_budget`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function updateCampaignIdentification(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/update_campaign_identification`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function getAdsByInventoryReference(
	campaignId: string,
	q: Record<string, string>,
	ctx: KwContext,
): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/get_ads_by_inventory_reference?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function createAdsByInventoryReference(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/create_ads_by_inventory_reference`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function deleteAdsByInventoryReference(
	campaignId: string,
	body: Record<string, unknown>,
	ctx: KwContext,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/ad_campaign/${encodeURIComponent(campaignId)}/delete_ads_by_inventory_reference`,
		body,
		marketplace: ctx.marketplace,
	});
}
export async function getPromotionReport(q: Record<string, string>, ctx: KwContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/promotion_report?${params}`,
		marketplace: ctx.marketplace,
	});
}
export async function getAdReport(id: string, ctx: KwContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/ad_report/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}
