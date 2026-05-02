/**
 * buy/deal — eBay's curated daily deals + events.
 */

import type { FeaturedDeal, FeaturedDealKind } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { fetchRetry } from "../utils/fetch-retry.js";
import { getAppAccessToken } from "./ebay/oauth.js";
import { ebayItemToFlipagent } from "./items/transform.js";

interface EbayDealItem {
	itemId: string;
	legacyItemId?: string;
	title: string;
	itemWebUrl: string;
	dealId?: string;
	eventId?: string;
	eventTitle?: string;
	dealAffiliateWebUrl?: string;
	additionalSavings?: string;
	endDate?: string;
}

interface DealsResponse {
	dealItems?: EbayDealItem[];
	total?: number;
}

export async function listFeatured(
	kind: FeaturedDealKind,
	q: { limit?: number; offset?: number; categoryIds?: string },
): Promise<{ deals: FeaturedDeal[]; limit: number; offset: number; total?: number }> {
	if (!isEbayAppConfigured()) return { deals: [], limit: 50, offset: 0 };
	const token = await getAppAccessToken();
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.categoryIds) params.set("category_ids", q.categoryIds);
	const path = kind === "daily_deal" ? "/buy/deal/v1/deal_item" : "/buy/deal/v1/event_item";
	const res = await fetchRetry(`${config.EBAY_BASE_URL}${path}?${params.toString()}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
	});
	if (!res.ok) return { deals: [], limit, offset };
	const body = (await res.json()) as DealsResponse;
	const deals: FeaturedDeal[] = (body.dealItems ?? []).map((d) => ({
		...ebayItemToFlipagent(d as never),
		dealKind: kind,
		dealId: d.dealId ?? "",
		...(d.eventId ? { eventId: d.eventId } : {}),
		...(d.eventTitle ? { eventTitle: d.eventTitle } : {}),
		...(d.additionalSavings ? { savingsPercentage: d.additionalSavings } : {}),
		...(d.endDate ? { endsAt: d.endDate } : {}),
	}));
	return { deals, limit, offset, ...(body.total !== undefined ? { total: body.total } : {}) };
}
