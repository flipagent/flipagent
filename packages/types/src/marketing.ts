/**
 * `/v1/promotions` (item discounts + markdowns) + `/v1/ads` (paid
 * campaigns + ad groups + reports). Wraps eBay sell/marketing.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page, ResponseSource } from "./_common.js";

/* ----------------------------- Promotions ---------------------------- */

export const PromotionType = Type.Union(
	[
		Type.Literal("order_discount"),
		Type.Literal("item_promotion"),
		Type.Literal("volume_discount"),
		Type.Literal("markdown"),
		Type.Literal("coded_coupon"),
	],
	{ $id: "PromotionType" },
);
export type PromotionType = Static<typeof PromotionType>;

export const PromotionStatus = Type.Union(
	[
		Type.Literal("draft"),
		Type.Literal("scheduled"),
		Type.Literal("running"),
		Type.Literal("paused"),
		Type.Literal("ended"),
	],
	{ $id: "PromotionStatus" },
);
export type PromotionStatus = Static<typeof PromotionStatus>;

export const Promotion = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		type: PromotionType,
		status: PromotionStatus,
		name: Type.String(),
		description: Type.Optional(Type.String()),
		discountPercent: Type.Optional(Type.Number()),
		discountAmount: Type.Optional(Money),
		startsAt: Type.Optional(Type.String()),
		endsAt: Type.Optional(Type.String()),
		appliesToSkus: Type.Optional(Type.Array(Type.String())),
		appliesToCategoryIds: Type.Optional(Type.Array(Type.String())),
		minOrderAmount: Type.Optional(Money),
		maxDiscountAmount: Type.Optional(Money),
		couponCode: Type.Optional(Type.String()),
	},
	{ $id: "Promotion" },
);
export type Promotion = Static<typeof Promotion>;

export const PromotionCreate = Type.Object(
	{
		type: PromotionType,
		name: Type.String(),
		description: Type.Optional(Type.String()),
		discountPercent: Type.Optional(Type.Number()),
		discountAmount: Type.Optional(Money),
		startsAt: Type.String(),
		endsAt: Type.String(),
		appliesToSkus: Type.Optional(Type.Array(Type.String())),
		appliesToCategoryIds: Type.Optional(Type.Array(Type.String())),
		minOrderAmount: Type.Optional(Money),
		maxDiscountAmount: Type.Optional(Money),
		couponCode: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "PromotionCreate" },
);
export type PromotionCreate = Static<typeof PromotionCreate>;

export const PromotionsListResponse = Type.Composite(
	[Page, Type.Object({ promotions: Type.Array(Promotion), source: Type.Optional(ResponseSource) })],
	{ $id: "PromotionsListResponse" },
);
export type PromotionsListResponse = Static<typeof PromotionsListResponse>;

/* ------------------------------- Ads --------------------------------- */

export const AdCampaignStatus = Type.Union(
	[Type.Literal("running"), Type.Literal("paused"), Type.Literal("ended"), Type.Literal("draft")],
	{ $id: "AdCampaignStatus" },
);
export type AdCampaignStatus = Static<typeof AdCampaignStatus>;

export const AdCampaignFundingModel = Type.Union(
	[
		Type.Literal("non_promoted"),
		Type.Literal("priority"),
		Type.Literal("flat_rate"),
		Type.Literal("cost_per_sale"),
		Type.Literal("cost_per_acquisition"),
	],
	{ $id: "AdCampaignFundingModel" },
);
export type AdCampaignFundingModel = Static<typeof AdCampaignFundingModel>;

export const AdCampaign = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		name: Type.String(),
		status: AdCampaignStatus,
		fundingModel: AdCampaignFundingModel,
		startsAt: Type.Optional(Type.String()),
		endsAt: Type.Optional(Type.String()),
		budget: Type.Optional(Money),
		targetingStrategy: Type.Optional(Type.String()),
	},
	{ $id: "AdCampaign" },
);
export type AdCampaign = Static<typeof AdCampaign>;

export const Ad = Type.Object(
	{
		id: Type.String(),
		campaignId: Type.String(),
		listingId: Type.String(),
		bidPercentage: Type.Optional(Type.String()),
		status: Type.String(),
	},
	{ $id: "Ad" },
);
export type Ad = Static<typeof Ad>;

export const AdsListResponse = Type.Composite(
	[Page, Type.Object({ campaigns: Type.Array(AdCampaign), source: Type.Optional(ResponseSource) })],
	{ $id: "AdsListResponse" },
);
export type AdsListResponse = Static<typeof AdsListResponse>;

export const AdCampaignCreate = Type.Object(
	{
		name: Type.String(),
		fundingModel: AdCampaignFundingModel,
		startsAt: Type.Optional(Type.String()),
		endsAt: Type.Optional(Type.String()),
		budget: Type.Optional(Money),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "AdCampaignCreate" },
);
export type AdCampaignCreate = Static<typeof AdCampaignCreate>;

/* ─── bulk ad ops ─── */

export const AdCampaignCloneRequest = Type.Object(
	{ name: Type.String({ description: "New campaign name (required by eBay)." }) },
	{ $id: "AdCampaignCloneRequest" },
);
export type AdCampaignCloneRequest = Static<typeof AdCampaignCloneRequest>;

export const AdBidUpdateRequest = Type.Object(
	{ bidPercentage: Type.String({ description: 'eBay-format string, e.g. "5.0".' }) },
	{ $id: "AdBidUpdateRequest" },
);
export type AdBidUpdateRequest = Static<typeof AdBidUpdateRequest>;

const BulkAdRow = Type.Object(
	{
		listingId: Type.String(),
		bidPercentage: Type.Optional(Type.String()),
	},
	{ $id: "BulkAdRow" },
);

export const BulkAdsByListingRequest = Type.Object(
	{ requests: Type.Array(BulkAdRow, { minItems: 1, maxItems: 500 }) },
	{ $id: "BulkAdsByListingRequest" },
);
export type BulkAdsByListingRequest = Static<typeof BulkAdsByListingRequest>;

export const BulkAdsByListingDeleteRequest = Type.Object(
	{ listingIds: Type.Array(Type.String(), { minItems: 1, maxItems: 500 }) },
	{ $id: "BulkAdsByListingDeleteRequest" },
);
export type BulkAdsByListingDeleteRequest = Static<typeof BulkAdsByListingDeleteRequest>;

export const BulkAdsStatusRequest = Type.Object(
	{
		requests: Type.Array(
			Type.Object({
				listingId: Type.String(),
				adStatus: Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED")]),
			}),
			{ minItems: 1, maxItems: 500 },
		),
	},
	{ $id: "BulkAdsStatusRequest" },
);
export type BulkAdsStatusRequest = Static<typeof BulkAdsStatusRequest>;

export const BulkAdsResponse = Type.Object(
	{
		results: Type.Array(
			Type.Object({
				listingId: Type.String(),
				adId: Type.Optional(Type.String()),
				status: Type.Optional(Type.String()),
				errors: Type.Optional(Type.Unknown()),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "BulkAdsResponse" },
);
export type BulkAdsResponse = Static<typeof BulkAdsResponse>;

/* --------------------------- Markdowns ------------------------------- */

export const PriceMarkdown = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		name: Type.String(),
		appliesToSkus: Type.Array(Type.String()),
		discountPercent: Type.Number(),
		startsAt: Type.String(),
		endsAt: Type.String(),
		status: Type.Union([Type.Literal("scheduled"), Type.Literal("running"), Type.Literal("ended")]),
	},
	{ $id: "PriceMarkdown" },
);
export type PriceMarkdown = Static<typeof PriceMarkdown>;

export const PriceMarkdownCreate = Type.Object(
	{
		name: Type.String(),
		appliesToSkus: Type.Array(Type.String(), { minItems: 1 }),
		discountPercent: Type.Number({ minimum: 1, maximum: 90 }),
		startsAt: Type.String(),
		endsAt: Type.String(),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "PriceMarkdownCreate" },
);
export type PriceMarkdownCreate = Static<typeof PriceMarkdownCreate>;

export const PriceMarkdownsListResponse = Type.Composite(
	[Page, Type.Object({ markdowns: Type.Array(PriceMarkdown), source: Type.Optional(ResponseSource) })],
	{ $id: "PriceMarkdownsListResponse" },
);
export type PriceMarkdownsListResponse = Static<typeof PriceMarkdownsListResponse>;

/* ----------------------------- Ad groups ----------------------------- */

export const AdGroup = Type.Object(
	{
		id: Type.String(),
		campaignId: Type.String(),
		name: Type.String(),
		status: Type.Union([Type.Literal("active"), Type.Literal("paused"), Type.Literal("ended")]),
		defaultBidPercentage: Type.Optional(Type.String()),
	},
	{ $id: "AdGroup" },
);
export type AdGroup = Static<typeof AdGroup>;

export const AdGroupCreate = Type.Object(
	{
		name: Type.String(),
		defaultBidPercentage: Type.Optional(Type.String()),
	},
	{ $id: "AdGroupCreate" },
);
export type AdGroupCreate = Static<typeof AdGroupCreate>;

export const AdGroupsListResponse = Type.Object(
	{ groups: Type.Array(AdGroup), source: Type.Optional(ResponseSource) },
	{ $id: "AdGroupsListResponse" },
);
export type AdGroupsListResponse = Static<typeof AdGroupsListResponse>;

/* ----------------------------- Reports ------------------------------- */

export const ReportTaskStatus = Type.Union(
	[Type.Literal("pending"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed")],
	{ $id: "ReportTaskStatus" },
);
export type ReportTaskStatus = Static<typeof ReportTaskStatus>;

export const ReportTaskKind = Type.Union([Type.Literal("ad"), Type.Literal("promotion_summary")], {
	$id: "ReportTaskKind",
});
export type ReportTaskKind = Static<typeof ReportTaskKind>;

export const ReportTask = Type.Object(
	{
		id: Type.String(),
		kind: ReportTaskKind,
		status: ReportTaskStatus,
		from: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
		downloadUrl: Type.Optional(Type.String()),
		dimensions: Type.Optional(Type.Array(Type.String())),
		metrics: Type.Optional(Type.Array(Type.String())),
		createdAt: Type.String(),
		completedAt: Type.Optional(Type.String()),
	},
	{ $id: "ReportTask" },
);
export type ReportTask = Static<typeof ReportTask>;

export const ReportTaskCreate = Type.Object(
	{
		kind: ReportTaskKind,
		from: Type.String(),
		to: Type.String(),
		dimensions: Type.Optional(Type.Array(Type.String())),
		metrics: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "ReportTaskCreate" },
);
export type ReportTaskCreate = Static<typeof ReportTaskCreate>;

export const ReportTasksListResponse = Type.Object(
	{ tasks: Type.Array(ReportTask), source: Type.Optional(ResponseSource) },
	{ $id: "ReportTasksListResponse" },
);
export type ReportTasksListResponse = Static<typeof ReportTasksListResponse>;

export const ReportMetadata = Type.Object(
	{
		dimensions: Type.Array(Type.Object({ name: Type.String(), description: Type.Optional(Type.String()) })),
		metrics: Type.Array(Type.Object({ name: Type.String(), description: Type.Optional(Type.String()) })),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "ReportMetadata" },
);
export type ReportMetadata = Static<typeof ReportMetadata>;
