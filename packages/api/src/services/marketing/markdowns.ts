/**
 * sell/marketing — item-price markdown campaigns.
 */

import type { PriceMarkdown, PriceMarkdownCreate } from "@flipagent/types";
import { sellRequest, sellRequestWithLocation, swallowEbay404 } from "../ebay/rest/user-client.js";
import type { MarketingContext } from "./promotions.js";

interface EbayMarkdown {
	campaignId: string;
	campaignName: string;
	startDate: string;
	endDate: string;
	discountPercent: number;
	listingIds?: string[];
	campaignStatus?: string;
}

function markdownFrom(m: EbayMarkdown): PriceMarkdown {
	const status = m.campaignStatus === "RUNNING" ? "running" : m.campaignStatus === "ENDED" ? "ended" : "scheduled";
	return {
		id: m.campaignId,
		marketplace: "ebay_us",
		name: m.campaignName,
		appliesToSkus: m.listingIds ?? [],
		discountPercent: m.discountPercent,
		startsAt: m.startDate,
		endsAt: m.endDate,
		status,
	};
}

export async function listMarkdowns(
	q: { limit?: number; offset?: number },
	ctx: MarketingContext,
): Promise<{ markdowns: PriceMarkdown[]; limit: number; offset: number }> {
	// Verified live 2026-05-02: `/item_price_markdown` is POST-only
	// (create). The list shape is `/promotion?marketplace_id=&promotion_type=
	// MARKDOWN_SALE` — markdowns are a `Promotion` subtype on eBay's
	// generic promotion list. Returns `promotions` array (not `campaigns`).
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(offset),
		marketplace_id: ctx.marketplace ?? "EBAY_US",
		promotion_type: "MARKDOWN_SALE",
	});
	const res = await sellRequest<{
		promotions?: Array<EbayMarkdown & { promotionId?: string; name?: string; promotionStatus?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/promotion?${params.toString()}`,
	}).catch(swallowEbay404);
	const markdowns = (res?.promotions ?? []).map((p) =>
		markdownFrom({
			campaignId: p.promotionId ?? p.campaignId ?? "",
			campaignName: p.name ?? p.campaignName ?? "",
			startDate: p.startDate,
			endDate: p.endDate,
			discountPercent: p.discountPercent ?? 0,
			listingIds: p.listingIds,
			campaignStatus: p.promotionStatus ?? p.campaignStatus,
		}),
	);
	return { markdowns, limit, offset };
}

export async function getMarkdown(id: string, ctx: MarketingContext): Promise<PriceMarkdown | null> {
	const res = await sellRequest<EbayMarkdown & { promotionId?: string; name?: string; promotionStatus?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/item_price_markdown/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	if (!res) return null;
	return markdownFrom({
		campaignId: res.promotionId ?? res.campaignId ?? "",
		campaignName: res.name ?? res.campaignName ?? "",
		startDate: res.startDate,
		endDate: res.endDate,
		discountPercent: res.discountPercent ?? 0,
		listingIds: res.listingIds,
		campaignStatus: res.promotionStatus ?? res.campaignStatus,
	});
}

export async function deleteMarkdown(id: string, ctx: MarketingContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/marketing/v1/item_price_markdown/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}

export async function updateMarkdown(
	id: string,
	input: PriceMarkdownCreate,
	ctx: MarketingContext,
): Promise<{ id: string }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/marketing/v1/item_price_markdown/${encodeURIComponent(id)}`,
		body: {
			name: input.name,
			description: input.description ?? input.name.slice(0, 50),
			...(input.promotionImageUrl ? { promotionImageUrl: input.promotionImageUrl } : {}),
			marketplaceId: ctx.marketplace ?? "EBAY_US",
			promotionStatus: "SCHEDULED",
			startDate: input.startsAt,
			endDate: input.endsAt,
			selectedInventoryDiscounts: [
				{
					discountBenefit: { percentageOffItem: String(input.discountPercent) },
					inventoryCriterion: {
						inventoryCriterionType: "INVENTORY_BY_VALUE",
						listingIds: input.appliesToSkus,
					},
				},
			],
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id };
}

export async function createMarkdown(input: PriceMarkdownCreate, ctx: MarketingContext): Promise<PriceMarkdown> {
	// Body shape per OAS3 `ItemPriceMarkdown` schema
	// (`references/ebay-mcp/docs/_mirror/sell_marketing_v1_oas3.json`).
	// Verified via field-diff 2026-05-03: the previous flat-shape body
	// (`campaignName`, `discountPercent`, `listingIds`) was REJECTED on
	// every call — none of those fields exist in the spec. The real
	// shape nests the percentage inside `discountBenefit.percentageOffItem`
	// (string!) and the listings inside
	// `selectedInventoryDiscounts[].inventoryCriterion.listingIds`. The
	// response field is `promotionId`, not `campaignId`.
	// item_price_markdown also returns 201 with empty body + Location header.
	const { body: res, locationId } = await sellRequestWithLocation<{ promotionId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/marketing/v1/item_price_markdown",
		body: {
			name: input.name,
			// `description` is REQUIRED for MARKDOWN_SALE per spec — verified
			// live 2026-05-03 ("A valid entry is required for 'description'").
			// It's the seller-defined "tag line" buyers see (max 50 chars).
			description: input.description ?? input.name.slice(0, 50),
			// `promotionImageUrl` REQUIRED for MARKDOWN_SALE — verified live
			// 2026-05-03. URL to JPEG/PNG ≥500×500px. eBay doesn't host
			// images; caller supplies a public URL (typically reused from
			// an existing listing image).
			...(input.promotionImageUrl ? { promotionImageUrl: input.promotionImageUrl } : {}),
			marketplaceId: ctx.marketplace ?? "EBAY_US",
			promotionStatus: "SCHEDULED",
			startDate: input.startsAt,
			endDate: input.endsAt,
			selectedInventoryDiscounts: [
				{
					discountBenefit: { percentageOffItem: String(input.discountPercent) },
					inventoryCriterion: {
						inventoryCriterionType: "INVENTORY_BY_VALUE",
						listingIds: input.appliesToSkus,
					},
				},
			],
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.promotionId ?? locationId ?? "",
		marketplace: input.marketplace ?? "ebay_us",
		name: input.name,
		appliesToSkus: input.appliesToSkus,
		discountPercent: input.discountPercent,
		startsAt: input.startsAt,
		endsAt: input.endsAt,
		status: "scheduled",
	};
}
