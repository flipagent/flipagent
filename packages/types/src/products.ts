/**
 * `/v1/products` — universal product catalog (eBay EPID). Normalized
 * `Product` shape with cents-int Money for `averagePrice`.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page, ResponseSource } from "./_common.js";

export const Product = Type.Object(
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
	{ $id: "Product" },
);
export type Product = Static<typeof Product>;

export const ProductSearchQuery = Type.Object(
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
	{ $id: "ProductSearchQuery" },
);
export type ProductSearchQuery = Static<typeof ProductSearchQuery>;

export const ProductsListResponse = Type.Composite(
	[Page, Type.Object({ products: Type.Array(Product), source: Type.Optional(ResponseSource) })],
	{ $id: "ProductsListResponse" },
);
export type ProductsListResponse = Static<typeof ProductsListResponse>;

export const ProductResponse = Type.Composite([Product, Type.Object({ source: Type.Optional(ResponseSource) })], {
	$id: "ProductResponse",
});
export type ProductResponse = Static<typeof ProductResponse>;

/**
 * Catalog product-metadata read. Returns required-/recommended-aspect
 * names and sample values for a given EPID (or category). Useful for
 * agents that need to fill `aspects` correctly before listing.
 */
export const ProductMetadataQuery = Type.Object(
	{
		epid: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ProductMetadataQuery" },
);
export type ProductMetadataQuery = Static<typeof ProductMetadataQuery>;

export const ProductMetadataAspect = Type.Object(
	{
		name: Type.String(),
		dataType: Type.Optional(Type.String()),
		required: Type.Optional(Type.Boolean()),
		multiValued: Type.Optional(Type.Boolean()),
		values: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "ProductMetadataAspect" },
);
export type ProductMetadataAspect = Static<typeof ProductMetadataAspect>;

export const ProductMetadataResponse = Type.Object(
	{
		epid: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		aspects: Type.Array(ProductMetadataAspect),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "ProductMetadataResponse" },
);
export type ProductMetadataResponse = Static<typeof ProductMetadataResponse>;

export const ProductMetadataForCategoriesQuery = Type.Object(
	{
		categoryIds: Type.String({ description: "Comma-separated category ids." }),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ProductMetadataForCategoriesQuery" },
);
export type ProductMetadataForCategoriesQuery = Static<typeof ProductMetadataForCategoriesQuery>;

export const ProductMetadataForCategoriesResponse = Type.Object(
	{
		entries: Type.Array(
			Type.Object({
				categoryId: Type.String(),
				aspects: Type.Array(ProductMetadataAspect),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "ProductMetadataForCategoriesResponse" },
);
export type ProductMetadataForCategoriesResponse = Static<typeof ProductMetadataForCategoriesResponse>;
