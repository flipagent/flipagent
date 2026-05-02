/**
 * sell/marketing — item-price markdown campaigns.
 */

import type { PriceMarkdown, PriceMarkdownCreate } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";
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
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	const res = await sellRequest<{ campaigns?: EbayMarkdown[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/item_price_markdown?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return { markdowns: (res?.campaigns ?? []).map(markdownFrom), limit, offset };
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
