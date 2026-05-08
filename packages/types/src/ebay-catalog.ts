/**
 * `/v1/marketplaces/ebay/catalog/*` — eBay's catalog product mirror,
 * keyed on EPID. Distinct from flipagent's native cross-marketplace
 * catalog (`/v1/products/*`, types in `products.ts`); this is a pass-
 * through view of eBay's authoritative product DB, useful for filling
 * `aspects` correctly before listing or pulling a canonical title /
 * GTIN / MPN tuple.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page } from "./_common.js";

export const EbayCatalogProduct = Type.Object(
	{
		epid: Type.String({ description: "eBay catalog product id." }),
		marketplace: Marketplace,
		title: Type.String(),
		brand: Type.Optional(Type.String()),
		mpn: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		images: Type.Array(Type.String()),
		aspects: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
		category: Type.Optional(Type.Object({ id: Type.String(), name: Type.Optional(Type.String()) })),
		averagePrice: Type.Optional(Money),
		listingCount: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ $id: "EbayCatalogProduct" },
);
export type EbayCatalogProduct = Static<typeof EbayCatalogProduct>;

export const EbayCatalogSearchQuery = Type.Object(
	{
		q: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.String()),
		mpn: Type.Optional(Type.String()),
		brand: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "EbayCatalogSearchQuery" },
);
export type EbayCatalogSearchQuery = Static<typeof EbayCatalogSearchQuery>;

export const EbayCatalogListResponse = Type.Composite(
	[Page, Type.Object({ products: Type.Array(EbayCatalogProduct) })],
	{
		$id: "EbayCatalogListResponse",
	},
);
export type EbayCatalogListResponse = Static<typeof EbayCatalogListResponse>;

export const EbayCatalogProductResponse = Type.Composite([EbayCatalogProduct], {
	$id: "EbayCatalogProductResponse",
});
export type EbayCatalogProductResponse = Static<typeof EbayCatalogProductResponse>;

export const EbayCatalogMetadataQuery = Type.Object(
	{
		epid: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "EbayCatalogMetadataQuery" },
);
export type EbayCatalogMetadataQuery = Static<typeof EbayCatalogMetadataQuery>;

export const EbayCatalogMetadataAspect = Type.Object(
	{
		name: Type.String(),
		dataType: Type.Optional(Type.String()),
		required: Type.Optional(Type.Boolean()),
		multiValued: Type.Optional(Type.Boolean()),
		values: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "EbayCatalogMetadataAspect" },
);
export type EbayCatalogMetadataAspect = Static<typeof EbayCatalogMetadataAspect>;

export const EbayCatalogMetadataResponse = Type.Object(
	{
		epid: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		aspects: Type.Array(EbayCatalogMetadataAspect),
	},
	{ $id: "EbayCatalogMetadataResponse" },
);
export type EbayCatalogMetadataResponse = Static<typeof EbayCatalogMetadataResponse>;

export const EbayCatalogMetadataForCategoriesQuery = Type.Object(
	{
		categoryIds: Type.String({ description: "Comma-separated category ids." }),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "EbayCatalogMetadataForCategoriesQuery" },
);
export type EbayCatalogMetadataForCategoriesQuery = Static<typeof EbayCatalogMetadataForCategoriesQuery>;

export const EbayCatalogMetadataForCategoriesResponse = Type.Object(
	{
		entries: Type.Array(
			Type.Object({
				categoryId: Type.String(),
				aspects: Type.Array(EbayCatalogMetadataAspect),
			}),
		),
	},
	{ $id: "EbayCatalogMetadataForCategoriesResponse" },
);
export type EbayCatalogMetadataForCategoriesResponse = Static<typeof EbayCatalogMetadataForCategoriesResponse>;
