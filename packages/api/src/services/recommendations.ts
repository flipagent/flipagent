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
	// Verified live 2026-05-02: the actual eBay endpoint is `POST /find`
	// with body `{ listingIds: [...] }`. Our prior `GET /find_listing_recommendations`
	// 404'd silently. The OpenAPI marks this as POST not GET.
	//
	// Quirk: this endpoint's `marketplace_id` query param uses HYPHEN
	// (`EBAY-US`), not the canonical underscore form (`EBAY_US`) every
	// other Sell API uses. Confirmed by eBay's error message which
	// enumerates `EBAY-US, EBAY-GB, EBAY-AU, EBAY-DE`. Listings outside
	// those 4 marketplaces are not supported.
	if (!q.listingId) {
		// `find` requires at least one listingId (eBay returns 500 on
		// an empty body). Return empty rather than emit a server error.
		return { recommendations: [], limit: q.limit ?? 50, offset: q.offset ?? 0 };
	}
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const marketplaceHyphen = (ctx.marketplace ?? "EBAY_US").replace("_", "-");
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(offset),
		marketplace_id: marketplaceHyphen,
	});
	const res = await sellRequest<{ recommendations?: EbayRecommendation[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/recommendation/v1/find?${params.toString()}`,
		body: { listingIds: [q.listingId] },
		marketplace: ctx.marketplace,
	});
	const recommendations = (res?.recommendations ?? []).map((r) => ({
		listingId: r.listingId,
		marketplace: "ebay_us" as const,
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
