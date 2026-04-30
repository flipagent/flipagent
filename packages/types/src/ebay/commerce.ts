/**
 * TypeBox schemas mirroring eBay Commerce Catalog API response shapes.
 * Field names + nesting match eBay's documented `Product` type exactly
 * so callers using the official eBay SDK at api.ebay.com see the same
 * shape against api.flipagent.dev.
 *
 * @see https://developer.ebay.com/api-docs/commerce/catalog/types/catal:Product
 * @see https://developer.ebay.com/api-docs/commerce/catalog/resources/product/methods/getProduct
 */

import { type Static, Type } from "@sinclair/typebox";

export const CatalogImage = Type.Object(
	{
		height: Type.Optional(Type.Integer()),
		imageUrl: Type.Optional(Type.String()),
		width: Type.Optional(Type.Integer()),
	},
	{ $id: "CatalogImage" },
);
export type CatalogImage = Static<typeof CatalogImage>;

export const CatalogAspect = Type.Object(
	{
		localizedName: Type.Optional(Type.String()),
		localizedValues: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "CatalogAspect" },
);
export type CatalogAspect = Static<typeof CatalogAspect>;

/**
 * Mirrors eBay's documented `Product` type field-for-field. eBay marks
 * every field optional including `epid`; we keep our public emission
 * always populating `epid` since the lookup is by EPID, but the schema
 * tracks the docs.
 */
export const CatalogProduct = Type.Object(
	{
		additionalImages: Type.Optional(Type.Array(CatalogImage)),
		aspects: Type.Optional(Type.Array(CatalogAspect)),
		brand: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		ean: Type.Optional(Type.Array(Type.String())),
		epid: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.Array(Type.String())),
		image: Type.Optional(CatalogImage),
		isbn: Type.Optional(Type.Array(Type.String())),
		mpn: Type.Optional(Type.Array(Type.String())),
		otherApplicableCategoryIds: Type.Optional(Type.Array(Type.String())),
		primaryCategoryId: Type.Optional(Type.String()),
		productWebUrl: Type.Optional(Type.String()),
		title: Type.Optional(Type.String()),
		upc: Type.Optional(Type.Array(Type.String())),
		version: Type.Optional(Type.String()),
	},
	{ $id: "CatalogProduct" },
);
export type CatalogProduct = Static<typeof CatalogProduct>;

export const CatalogProductParams = Type.Object({
	epid: Type.String({ pattern: "^\\d{6,}$", description: "eBay Product Identifier (numeric)." }),
});
export type CatalogProductParams = Static<typeof CatalogProductParams>;

/**
 * Subset of `Product` returned in a search hit. Mirrors eBay's
 * `ProductSummary` field-for-field: drops `description`,
 * `primaryCategoryId`, `otherApplicableCategoryIds`, `version`; adds
 * `productHref` (URI back to `getProduct`).
 *
 * @see https://developer.ebay.com/api-docs/commerce/catalog/types/catal:ProductSummary
 */
export const CatalogProductSummary = Type.Object(
	{
		additionalImages: Type.Optional(Type.Array(CatalogImage)),
		aspects: Type.Optional(Type.Array(CatalogAspect)),
		brand: Type.Optional(Type.String()),
		ean: Type.Optional(Type.Array(Type.String())),
		epid: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.Array(Type.String())),
		image: Type.Optional(CatalogImage),
		isbn: Type.Optional(Type.Array(Type.String())),
		mpn: Type.Optional(Type.Array(Type.String())),
		productHref: Type.Optional(Type.String()),
		productWebUrl: Type.Optional(Type.String()),
		title: Type.Optional(Type.String()),
		upc: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "CatalogProductSummary" },
);
export type CatalogProductSummary = Static<typeof CatalogProductSummary>;

export const CatalogAspectValueDistribution = Type.Object(
	{
		localizedAspectValue: Type.Optional(Type.String()),
		matchCount: Type.Optional(Type.Integer()),
		refinementHref: Type.Optional(Type.String()),
	},
	{ $id: "CatalogAspectValueDistribution" },
);
export type CatalogAspectValueDistribution = Static<typeof CatalogAspectValueDistribution>;

export const CatalogAspectDistribution = Type.Object(
	{
		aspectValueDistributions: Type.Optional(Type.Array(CatalogAspectValueDistribution)),
		localizedAspectName: Type.Optional(Type.String()),
	},
	{ $id: "CatalogAspectDistribution" },
);
export type CatalogAspectDistribution = Static<typeof CatalogAspectDistribution>;

export const CatalogRefinement = Type.Object(
	{
		aspectDistributions: Type.Optional(Type.Array(CatalogAspectDistribution)),
		dominantCategoryId: Type.Optional(Type.String()),
	},
	{ $id: "CatalogRefinement" },
);
export type CatalogRefinement = Static<typeof CatalogRefinement>;

/**
 * Mirrors eBay's `ProductSearchResponse` field-for-field. eBay keeps
 * `href`, `next`, `prev`, `total` reserved-for-internal-use today —
 * we surface them as optionals so the wire shape stays compatible if
 * eBay turns them on.
 *
 * @see https://developer.ebay.com/api-docs/commerce/catalog/types/catal:ProductSearchResponse
 */
export const CatalogProductSearchResponse = Type.Object(
	{
		href: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer()),
		next: Type.Optional(Type.String()),
		offset: Type.Optional(Type.Integer()),
		prev: Type.Optional(Type.String()),
		productSummaries: Type.Optional(Type.Array(CatalogProductSummary)),
		refinement: Type.Optional(CatalogRefinement),
		total: Type.Optional(Type.Integer()),
	},
	{ $id: "CatalogProductSearchResponse" },
);
export type CatalogProductSearchResponse = Static<typeof CatalogProductSearchResponse>;

/**
 * Query parameters for `GET /commerce/catalog/v1_beta/product_summary/search`.
 * Fields named exactly as eBay docs (`category_ids`, `aspect_filter`,
 * `fieldgroups` — including the lowercase casing eBay uses on the wire).
 */
export const CatalogSearchQuery = Type.Object({
	q: Type.Optional(Type.String()),
	gtin: Type.Optional(Type.String()),
	mpn: Type.Optional(Type.String()),
	category_ids: Type.Optional(Type.String()),
	aspect_filter: Type.Optional(Type.String()),
	fieldgroups: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type CatalogSearchQuery = Static<typeof CatalogSearchQuery>;
