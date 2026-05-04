/**
 * buy/deal — eBay's curated daily deals + events.
 * buy/marketing — merchandised products + also-bought / also-viewed (LR).
 *
 * Both belong here because they're buy-side marketplace recommendation
 * surfaces (eBay-curated, not seller-specific). The `/v1/recommendations`
 * surface is the inverse: sell-side listing-optimization tips for the
 * caller's own listings.
 */

import type {
	FeaturedDeal,
	FeaturedDealKind,
	MerchandisedProduct,
	MerchandisedProductsResponse,
	RelatedByProductResponse,
} from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { fetchRetry } from "../utils/fetch-retry.js";
import { getAppAccessToken } from "./ebay/oauth.js";
import { appRequest } from "./ebay/rest/app-client.js";
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

/* ---------------- Buy Marketing (LR) ---------------- */

interface EbayMerchandisedProduct {
	epid?: string;
	title?: string;
	image?: { imageUrl?: string };
	averagePrice?: { value?: string; currency?: string };
	ratingAggregate?: number;
	reviewCount?: number;
}

function ebayMerchandisedToFlipagent(p: EbayMerchandisedProduct): MerchandisedProduct {
	return {
		title: p.title ?? "",
		...(p.epid ? { epid: p.epid } : {}),
		...(p.image?.imageUrl ? { image: p.image.imageUrl } : {}),
		...(p.averagePrice?.value ? { averagePrice: p.averagePrice.value } : {}),
		...(p.ratingAggregate !== undefined ? { ratingAggregate: p.ratingAggregate } : {}),
		...(p.reviewCount !== undefined ? { reviewCount: p.reviewCount } : {}),
	};
}

export async function listMerchandisedProducts(
	q: { categoryId: string; metricName?: string; aspectFilter?: string; limit?: number },
	marketplace?: string,
): Promise<MerchandisedProductsResponse> {
	const params = new URLSearchParams({
		category_id: q.categoryId,
		metric_name: q.metricName ?? "BEST_SELLING",
	});
	if (q.aspectFilter) params.set("aspect_filter", q.aspectFilter);
	if (q.limit) params.set("limit", String(q.limit));
	const res = await appRequest<{ merchandisedProducts?: EbayMerchandisedProduct[] }>({
		method: "GET",
		path: `/buy/marketing/v1_beta/merchandised_product?${params.toString()}`,
		marketplace,
	});
	return {
		products: (res?.merchandisedProducts ?? []).map(ebayMerchandisedToFlipagent),
	};
}

async function relatedByProduct(
	verb: "get_also_bought_products" | "get_also_viewed_products",
	q: { epid?: string; gtin?: string },
	marketplace?: string,
): Promise<RelatedByProductResponse> {
	if (!q.epid && !q.gtin) {
		return { products: [] };
	}
	const params = new URLSearchParams();
	if (q.epid) params.set("epid", q.epid);
	if (q.gtin) params.set("gtin", q.gtin);
	const res = await appRequest<{ merchandisedProducts?: EbayMerchandisedProduct[] }>({
		method: "GET",
		path: `/buy/marketing/v1_beta/merchandised_product/${verb}?${params.toString()}`,
		marketplace,
	});
	return {
		products: (res?.merchandisedProducts ?? []).map(ebayMerchandisedToFlipagent),
	};
}

export async function listAlsoBoughtByProduct(
	q: { epid?: string; gtin?: string },
	marketplace?: string,
): Promise<RelatedByProductResponse> {
	return relatedByProduct("get_also_bought_products", q, marketplace);
}

export async function listAlsoViewedByProduct(
	q: { epid?: string; gtin?: string },
	marketplace?: string,
): Promise<RelatedByProductResponse> {
	return relatedByProduct("get_also_viewed_products", q, marketplace);
}
