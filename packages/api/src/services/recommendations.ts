/**
 * sell/recommendation — listing-level optimization suggestions
 * (promoted-listings bid, international shipping, better title).
 */

import type { Recommendation, RecommendationsListQuery } from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";

interface EbayRecommendation {
	listingId: string;
	sku?: string;
	marketing?: { ad?: { trends?: Array<{ ad?: { suggestedBidPercentage?: string } }> } };
	recommendations?: Array<{
		ad?: { suggestedBidPercentage?: string };
		internationalShipping?: unknown;
		title?: { recommendedTitle?: string };
	}>;
}

export interface RecommendationsContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function listRecommendations(
	q: RecommendationsListQuery,
	ctx: RecommendationsContext,
): Promise<{ recommendations: Recommendation[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.listingId) params.set("filter", `listingIds:{${q.listingId}}`);
	const res = await sellRequest<{ recommendations?: EbayRecommendation[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/recommendation/v1/find_listing_recommendations?${params.toString()}`,
		marketplace: ctx.marketplace,
	});
	const recommendations = (res?.recommendations ?? []).map((r) => ({
		listingId: r.listingId,
		marketplace: "ebay" as const,
		...(r.sku ? { sku: r.sku } : {}),
		recommendations: (r.recommendations ?? []).flatMap((rec) => {
			const out: Recommendation["recommendations"] = [];
			if (rec.ad?.suggestedBidPercentage) {
				out.push({ type: "AD", suggestedBidPercentage: rec.ad.suggestedBidPercentage });
			}
			if (rec.internationalShipping) out.push({ type: "INTERNATIONAL_SHIPPING" });
			if (rec.title?.recommendedTitle) out.push({ type: "TITLE", message: rec.title.recommendedTitle });
			return out;
		}),
	}));
	return { recommendations, limit, offset, ...(res?.total !== undefined ? { total: res.total } : {}) };
}
