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
import { sellRequest, sellRequestWithLocation, swallowEbay404 } from "../ebay/rest/user-client.js";
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
		// `marketplaceId` is REQUIRED on the Promotion body — verified live
		// 2026-05-03 ("A valid entry is required for 'marketplaceId'").
		// The `marketplace` arg in the sellRequest opts only sets the
		// `X-EBAY-C-MARKETPLACE-ID` header; the body field is separate.
		marketplaceId: ctx.marketplace ?? "EBAY_US",
		promotionType: PROMO_TYPE_TO[input.type],
		// SCHEDULED is the only status acceptable for create per spec
		// (DRAFT for editing-in-progress only).
		promotionStatus: "SCHEDULED",
		startDate: input.startsAt,
		endDate: input.endsAt,
		// `description` is REQUIRED for MARKDOWN_SALE / CODED_COUPON / etc.
		// — the seller-defined "tag line" buyers see (max 50 chars).
		// Default to the name when caller doesn't supply one.
		description: input.description ?? input.name.slice(0, 50),
		// `promotionImageUrl` REQUIRED for MARKDOWN_SALE / CODED_COUPON
		// / ORDER_DISCOUNT (verified live 2026-05-03). URL to JPEG/PNG
		// ≥500×500px. Caller supplies a public URL.
		...(input.promotionImageUrl ? { promotionImageUrl: input.promotionImageUrl } : {}),
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
	// item_promotion returns 201 with empty body + `Location` header
	// containing the new promotionId. Same pattern as custom_policy.
	const { body: res, locationId } = await sellRequestWithLocation<{ promotionId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/marketing/v1/item_promotion",
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return {
		id: res?.promotionId ?? locationId ?? "",
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

/* ---------- promotion lifecycle ---------- */

export async function getPromotion(id: string, ctx: MarketingContext): Promise<Promotion | null> {
	const res = await sellRequest<EbayPromotion>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/item_promotion/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return res ? ebayPromotionToFlipagent(res) : null;
}

export async function updatePromotion(
	id: string,
	input: PromotionCreate,
	ctx: MarketingContext,
): Promise<{ id: string }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/marketing/v1/item_promotion/${encodeURIComponent(id)}`,
		body: {
			name: input.name,
			marketplaceId: ctx.marketplace ?? "EBAY_US",
			promotionType: PROMO_TYPE_TO[input.type],
			promotionStatus: "SCHEDULED",
			startDate: input.startsAt,
			endDate: input.endsAt,
			description: input.description ?? input.name.slice(0, 50),
			...(input.promotionImageUrl ? { promotionImageUrl: input.promotionImageUrl } : {}),
			// `discountPercent` flipagent input maps to nested
			// `discountSpec.percentageOffItem` per spec — eBay's
			// `Promotion` schema doesn't carry a flat `discountPercent`
			// at the top level. For PUT we leave this out unless the
			// caller passes nested-style criteria.
			...(input.appliesToSkus
				? { inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE", listingIds: input.appliesToSkus } }
				: {}),
		},
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id };
}

export async function deletePromotion(id: string, ctx: MarketingContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/marketing/v1/item_promotion/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}

/**
 * Pause / resume work on the GENERIC `/promotion/{id}` resource (covers
 * both item_promotion and item_price_markdown — the generic pause/resume
 * works for either subtype).
 */
export async function pausePromotion(id: string, ctx: MarketingContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/promotion/${encodeURIComponent(id)}/pause`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function resumePromotion(id: string, ctx: MarketingContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/marketing/v1/promotion/${encodeURIComponent(id)}/resume`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function getPromotionListingSet(
	id: string,
	ctx: MarketingContext,
): Promise<{ listingIds: string[]; total: number }> {
	const res = await sellRequest<{ listingIds?: string[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/marketing/v1/promotion/${encodeURIComponent(id)}/get_listing_set`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return { listingIds: res?.listingIds ?? [], total: res?.total ?? 0 };
}

/** Dummy export to keep PromotionsListResponse type imported (used by route). */
export type _Promotions = PromotionsListResponse;
