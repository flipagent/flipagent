/**
 * sell/marketing — item-price markdown campaigns.
 */

import type { PriceMarkdown, PriceMarkdownCreate } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "../ebay/rest/user-client.js";
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
		marketplace: "ebay",
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
	const res = await sellRequest<{ promotions?: Array<EbayMarkdown & { promotionId?: string; name?: string; promotionStatus?: string }> }>({
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

export async function createMarkdown(input: PriceMarkdownCreate, ctx: MarketingContext): Promise<PriceMarkdown> {
	const res = await sellRequest<{ campaignId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/marketing/v1/item_price_markdown",
		body: {
			campaignName: input.name,
			startDate: input.startsAt,
			endDate: input.endsAt,
			discountPercent: input.discountPercent,
			listingIds: input.appliesToSkus,
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.campaignId ?? "",
		marketplace: input.marketplace ?? "ebay",
		name: input.name,
		appliesToSkus: input.appliesToSkus,
		discountPercent: input.discountPercent,
		startsAt: input.startsAt,
		endsAt: input.endsAt,
		status: "scheduled",
	};
}
