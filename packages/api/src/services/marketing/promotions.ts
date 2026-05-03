/**
 * sell/marketing — item promotions (item_promotion REST).
 */

import type {
	Promotion,
	PromotionCreate,
	PromotionStatus,
	PromotionsListResponse,
	PromotionType,
} from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "../ebay/rest/user-client.js";
import { toCents, toDollarString } from "../shared/money.js";

export interface MarketingContext {
	apiKeyId: string;
	marketplace?: string;
}

const PROMO_TYPE_FROM: Record<string, PromotionType> = {
	ORDER_DISCOUNT: "order_discount",
	ITEM_PROMOTION: "item_promotion",
	VOLUME_DISCOUNT: "volume_discount",
	MARKDOWN: "markdown",
	CODED_COUPON: "coded_coupon",
};

const PROMO_TYPE_TO: Record<PromotionType, string> = {
	order_discount: "ORDER_DISCOUNT",
	item_promotion: "ITEM_PROMOTION",
	volume_discount: "VOLUME_DISCOUNT",
	markdown: "MARKDOWN",
	coded_coupon: "CODED_COUPON",
};

const PROMO_STATUS_FROM: Record<string, PromotionStatus> = {
	DRAFT: "draft",
	SCHEDULED: "scheduled",
	RUNNING: "running",
	PAUSED: "paused",
	ENDED: "ended",
};

interface EbayPromotion {
	promotionId: string;
	promotionType: string;
	promotionStatus: string;
	name: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	discountAmount?: { value: string; currency: string };
	discountPercent?: number;
	couponCode?: string;
	inventoryCriterion?: { listingIds?: string[] };
	categoryIds?: string[];
	minOrderValue?: { value: string; currency: string };
	maxDiscountValue?: { value: string; currency: string };
}

function ebayPromotionToFlipagent(p: EbayPromotion): Promotion {
	const out: Promotion = {
		id: p.promotionId,
		marketplace: "ebay",
		type: PROMO_TYPE_FROM[p.promotionType] ?? "item_promotion",
		status: PROMO_STATUS_FROM[p.promotionStatus] ?? "draft",
		name: p.name,
	};
	if (p.description) out.description = p.description;
	if (p.discountPercent !== undefined) out.discountPercent = p.discountPercent;
	if (p.discountAmount)
		out.discountAmount = { value: toCents(p.discountAmount.value), currency: p.discountAmount.currency };
	if (p.startDate) out.startsAt = p.startDate;
	if (p.endDate) out.endsAt = p.endDate;
	if (p.inventoryCriterion?.listingIds) out.appliesToSkus = p.inventoryCriterion.listingIds;
	if (p.categoryIds) out.appliesToCategoryIds = p.categoryIds;
	if (p.minOrderValue)
		out.minOrderAmount = { value: toCents(p.minOrderValue.value), currency: p.minOrderValue.currency };
	if (p.maxDiscountValue)
		out.maxDiscountAmount = { value: toCents(p.maxDiscountValue.value), currency: p.maxDiscountValue.currency };
	if (p.couponCode) out.couponCode = p.couponCode;
	return out;
}

export async function listPromotions(
	q: { limit?: number; offset?: number; status?: PromotionStatus },
	ctx: MarketingContext,
): Promise<{ promotions: Promotion[]; limit: number; offset: number }> {
	// Verified live 2026-05-02: `/item_promotion` is POST-only (create).
	// The generic list endpoint is `/promotion?marketplace_id=&...` —
	// `marketplace_id` query param is REQUIRED (without it eBay 400s
	// "request has errors"). For markdown-style sales use
	// `services/marketing/markdowns.ts` (separate filter).
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(offset),
		marketplace_id: ctx.marketplace ?? "EBAY_US",
	});
	if (q.status) params.set("promotion_status", q.status.toUpperCase());
	const res = await sellRequest<{ promotions?: EbayPromotion[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/promotion?${params.toString()}`,
	}).catch(swallowEbay404);
	return { promotions: (res?.promotions ?? []).map(ebayPromotionToFlipagent), limit, offset };
}

export async function createPromotion(input: PromotionCreate, ctx: MarketingContext): Promise<Promotion> {
	const body: Record<string, unknown> = {
		name: input.name,
		promotionType: PROMO_TYPE_TO[input.type],
		startDate: input.startsAt,
		endDate: input.endsAt,
		...(input.description ? { description: input.description } : {}),
		...(input.discountPercent !== undefined ? { discountPercent: input.discountPercent } : {}),
		...(input.discountAmount
			? {
					discountAmount: {
						value: toDollarString(input.discountAmount.value),
						currency: input.discountAmount.currency,
					},
				}
			: {}),
		...(input.appliesToSkus
			? { inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE", listingIds: input.appliesToSkus } }
			: {}),
		...(input.appliesToCategoryIds ? { categoryIds: input.appliesToCategoryIds } : {}),
		...(input.minOrderAmount
			? {
					minOrderValue: {
						value: toDollarString(input.minOrderAmount.value),
						currency: input.minOrderAmount.currency,
					},
				}
			: {}),
		...(input.maxDiscountAmount
			? {
					maxDiscountValue: {
						value: toDollarString(input.maxDiscountAmount.value),
						currency: input.maxDiscountAmount.currency,
					},
				}
			: {}),
		...(input.couponCode ? { couponCode: input.couponCode } : {}),
	};
	const res = await sellRequest<{ promotionId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/marketing/v1/item_promotion",
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.promotionId ?? "",
		marketplace: input.marketplace ?? "ebay",
		type: input.type,
		status: "scheduled",
		name: input.name,
		...(input.description ? { description: input.description } : {}),
		...(input.discountPercent !== undefined ? { discountPercent: input.discountPercent } : {}),
		...(input.discountAmount ? { discountAmount: input.discountAmount } : {}),
		startsAt: input.startsAt,
		endsAt: input.endsAt,
		...(input.couponCode ? { couponCode: input.couponCode } : {}),
	};
}

/** Dummy export to keep PromotionsListResponse type imported (used by route). */
export type _Promotions = PromotionsListResponse;
