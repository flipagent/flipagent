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
