/**
 * `/v1/items/*` — marketplace listings, read-only. Unifies what eBay
 * splits into Browse (active) and Marketplace Insights (sold) plus
 * the per-item detail call. Same `Item` shape carries both states with
 * a `status` discriminator; `soldAt` / `soldPrice` populated for sold,
 * `endsAt` / `bidding` for active auctions.
 *
 * Cents-int Money, ISO timestamps, `marketplace` field on every record.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page, ResponseSource } from "./_common.js";

export const ItemStatus = Type.Union([Type.Literal("active"), Type.Literal("sold"), Type.Literal("ended")], {
	$id: "ItemStatus",
});
export type ItemStatus = Static<typeof ItemStatus>;

export const BuyingOption = Type.Union(
	[Type.Literal("auction"), Type.Literal("fixed_price"), Type.Literal("best_offer")],
	{ $id: "BuyingOption" },
);
export type BuyingOption = Static<typeof BuyingOption>;

export const ItemSeller = Type.Object(
	{
		username: Type.String(),
		feedbackScore: Type.Optional(Type.Integer()),
		/** "99.5" — eBay-shape percentage string, kept verbatim. */
		feedbackPercentage: Type.Optional(Type.String()),
	},
	{ $id: "ItemSeller" },
);
export type ItemSeller = Static<typeof ItemSeller>;

export const ItemLocation = Type.Object(
	{
		city: Type.Optional(Type.String()),
		region: Type.Optional(Type.String()),
		postalCode: Type.Optional(Type.String()),
		country: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
	},
	{ $id: "ItemLocation" },
);
export type ItemLocation = Static<typeof ItemLocation>;

export const ItemCategory = Type.Object(
	{
		id: Type.String(),
		name: Type.Optional(Type.String()),
		path: Type.Optional(Type.String({ description: "Slash-joined breadcrumb if known." })),
	},
	{ $id: "ItemCategory" },
);
export type ItemCategory = Static<typeof ItemCategory>;

export const ItemBidding = Type.Object(
	{
		count: Type.Integer({ minimum: 0 }),
		currentBid: Type.Optional(Money),
	},
	{ $id: "ItemBidding" },
);
export type ItemBidding = Static<typeof ItemBidding>;

export const ItemShipping = Type.Object(
	{
		/** Lowest cost across available options, or zero for free. */
		cost: Type.Optional(Money),
		/** Convenience flag — true when at least one option is free. */
		free: Type.Optional(Type.Boolean()),
		/** ISO 8601 — earliest predicted delivery date if upstream provided one. */
		estimatedDeliveryFrom: Type.Optional(Type.String()),
		estimatedDeliveryTo: Type.Optional(Type.String()),
		/** Region include / exclude lists from eBay's `shipToLocations`. */
		shipsTo: Type.Optional(
			Type.Array(Type.String({ description: "Country codes, region names, or eBay region ids." })),
		),
		shipsToExcluded: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "ItemShipping" },
);
export type ItemShipping = Static<typeof ItemShipping>;

export const ItemMarketingPrice = Type.Object(
	{
		originalPrice: Type.Optional(Money),
		discountAmount: Type.Optional(Money),
		discountPercentage: Type.Optional(Type.String()),
		priceTreatment: Type.Optional(
			Type.String({ description: "STRIKETHROUGH | LIST_PRICE | MINIMUM_ADVERTISED_PRICE | MARKDOWN" }),
		),
	},
	{ $id: "ItemMarketingPrice" },
);
export type ItemMarketingPrice = Static<typeof ItemMarketingPrice>;

export const ItemReturnTerms = Type.Object(
	{
		accepted: Type.Optional(Type.Boolean()),
		periodDays: Type.Optional(Type.Integer({ minimum: 0 })),
		shippingCostPayer: Type.Optional(Type.Union([Type.Literal("buyer"), Type.Literal("seller")])),
		refundMethod: Type.Optional(Type.String()),
		returnMethod: Type.Optional(Type.String()),
	},
	{ $id: "ItemReturnTerms" },
);
export type ItemReturnTerms = Static<typeof ItemReturnTerms>;

export const ItemConditionDescriptor = Type.Object(
	{
		name: Type.String({ description: "e.g. 'Professional Grader' or 'Grade'." }),
		values: Type.Array(Type.String()),
	},
	{ $id: "ItemConditionDescriptor" },
);
export type ItemConditionDescriptor = Static<typeof ItemConditionDescriptor>;

/**
 * Normalized listing. Same shape for active + sold; `status` discriminates
 * which optional field groups are populated. Goal: an LLM tool description
 * fits this in one screen.
 */
export const Item = Type.Object(
	{
		/** Marketplace-prefixed id: `"ebay:v|123|0"` (legacy) or `"ebay:123456789012"`. */
		id: Type.String(),
		marketplace: Marketplace,
		status: ItemStatus,
		title: Type.String(),
		/** Canonical web URL — preserved verbatim from upstream so ToS-required attribution works. */
		url: Type.String(),

		price: Type.Optional(Money),
		condition: Type.Optional(Type.String({ description: "Human-readable: 'New', 'Used', etc." })),
		conditionId: Type.Optional(Type.String({ description: "eBay-style numeric id, kept for filtering." })),

		seller: Type.Optional(ItemSeller),
		images: Type.Array(Type.String(), { description: "Image URLs in seller-supplied order. First is primary." }),

		category: Type.Optional(ItemCategory),
		aspects: Type.Optional(
			Type.Record(Type.String(), Type.String(), {
				description: "Item specifics — Brand/Model/Size/etc. Flat key→value map.",
			}),
		),

		buyingOptions: Type.Optional(Type.Array(BuyingOption)),

		// active-only
		endsAt: Type.Optional(Type.String({ description: "ISO 8601 listing end time." })),
		createdAt: Type.Optional(Type.String({ description: "ISO 8601 listing creation time." })),
		watchCount: Type.Optional(Type.Integer({ minimum: 0 })),
		bidding: Type.Optional(ItemBidding),

		// sold-only
		soldAt: Type.Optional(Type.String({ description: "ISO 8601 sold/closed time." })),
		soldPrice: Type.Optional(Money),
		soldQuantity: Type.Optional(Type.Integer({ minimum: 0 })),

		// shipping summary
		shipping: Type.Optional(ItemShipping),
		location: Type.Optional(ItemLocation),

		// universal identifiers
		epid: Type.Optional(Type.String({ description: "eBay catalog product id." })),
		gtin: Type.Optional(Type.String({ description: "UPC / EAN / ISBN." })),
		mpn: Type.Optional(Type.String({ description: "Manufacturer part number." })),

		/** Multi-variation parent group id when the listing is part of one. */
		groupId: Type.Optional(Type.String()),

		// rich detail (only populated on items/{id} or fieldgroups=EXTENDED)
		marketingPrice: Type.Optional(ItemMarketingPrice),
		returnTerms: Type.Optional(ItemReturnTerms),
		paymentMethods: Type.Optional(Type.Array(Type.String(), { description: "WALLET | CREDIT_CARD | …" })),
		conditionDescriptors: Type.Optional(Type.Array(ItemConditionDescriptor)),
		topRatedBuyingExperience: Type.Optional(Type.Boolean()),
		authenticityGuarantee: Type.Optional(Type.Boolean()),
		adultOnly: Type.Optional(Type.Boolean()),
		availableCoupons: Type.Optional(Type.Boolean()),
		qualifiedPrograms: Type.Optional(
			Type.Array(Type.String(), { description: "EBAY_REFURBISHED | AUTHENTICITY_GUARANTEE | …" }),
		),
		lotSize: Type.Optional(Type.Integer({ minimum: 0 })),
		quantityLimitPerBuyer: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ $id: "Item" },
);
export type Item = Static<typeof Item>;

/**
 * Search query. Cents-int prices, snake_case dropped, eBay's
 * `filter=conditionIds:{}|conditionIds:{}` → flat array. Keeps the
 * shape an LLM can populate from a user prompt without a translation
 * dictionary.
 */
export const ItemSearchQuery = Type.Object(
	{
		q: Type.Optional(Type.String({ description: "Keyword query." })),
		status: Type.Optional(ItemStatus),
		marketplace: Type.Optional(Marketplace),

		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),

		categoryId: Type.Optional(Type.String()),
		conditionIds: Type.Optional(Type.Array(Type.String())),
		buyingOption: Type.Optional(BuyingOption),

		priceMin: Type.Optional(Type.Integer({ description: "Minimum price in minor units (cents)." })),
		priceMax: Type.Optional(Type.Integer({ description: "Maximum price in minor units (cents)." })),

		epid: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.String()),
		groupId: Type.Optional(Type.String()),

		sort: Type.Optional(
			Type.Union([
				Type.Literal("relevance"),
				Type.Literal("price_asc"),
				Type.Literal("price_desc"),
				Type.Literal("newest"),
				Type.Literal("ending_soonest"),
			]),
		),

		/** ISO 3166-1 alpha-2 country to seed marketplace selection (`US` → eBay US, etc.). */
		country: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),

		/**
		 * Raw eBay filter expression for callers who need eBay's full
		 * filter syntax — `deliveryCountry:US,returnsAccepted:true,
		 * sellers:{nikeauthorized}`. Composed verbatim with our
		 * structured filters (categoryId/conditionIds/etc.).
		 */
		filter: Type.Optional(Type.String()),
		/** eBay aspect filter: `aspect_filter=categoryId:1234,Color:{Red|Blue}` */
		aspectFilter: Type.Optional(Type.String()),
		/** eBay fieldgroups: MATCHING_ITEMS | EXTENDED | FULL */
		fieldgroups: Type.Optional(Type.String()),
		/** eBay autoCorrect: KEYWORD */
		autoCorrect: Type.Optional(Type.String()),
		/** eBay compatibility filter for parts/motors */
		compatibilityFilter: Type.Optional(Type.String()),
		/** Charity ids (comma-separated). eBay for Charity surface. */
		charityIds: Type.Optional(Type.String()),
	},
	{ $id: "ItemSearchQuery" },
);
export type ItemSearchQuery = Static<typeof ItemSearchQuery>;

export const ItemSearchResponse = Type.Composite(
	[
		Page,
		Type.Object({
			items: Type.Array(Item),
			source: Type.Optional(ResponseSource),
		}),
	],
	{ $id: "ItemSearchResponse" },
);
export type ItemSearchResponse = Static<typeof ItemSearchResponse>;

/** GET /v1/items/{id} response — single Item plus source. */
export const ItemDetailResponse = Type.Composite([Item, Type.Object({ source: Type.Optional(ResponseSource) })], {
	$id: "ItemDetailResponse",
});
export type ItemDetailResponse = Static<typeof ItemDetailResponse>;

/** GET /v1/items/{id} query — `?status=` to read a sold listing. */
export const ItemDetailQuery = Type.Object(
	{
		status: Type.Optional(ItemStatus),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ItemDetailQuery" },
);
export type ItemDetailQuery = Static<typeof ItemDetailQuery>;
