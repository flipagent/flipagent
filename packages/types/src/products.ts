/**
 * `/v1/products/*` schema — flipagent's native cross-marketplace
 * product surface. A `Product` is the canonical SKU we trade in; marketplace
 * listings (eBay today; StockX / Mercari / GOAT next) attach as
 * observations referencing a product (and optionally a variant).
 *
 * Variants cover sized/colored sub-units (sneakers, clothes, bags).
 * Conditions are NOT modeled here — they live on the listing observation
 * and are sliced at the digest layer (`MarketView.byCondition`).
 *
 * `ProductRef` is the universal input shape: a route or service that
 * accepts "tell me about a product" takes a ProductRef. The Product
 * resolver (`services/products/resolve.ts`) maps it to a `(product,
 * variant?)` pair, auto-creating from a marketplace listing when no
 * match exists.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace } from "./_common.js";

/**
 * Catalog status:
 *   - `curated` — manually verified canonical entry
 *   - `auto`    — resolver-created from a marketplace listing
 *   - `pending` — auto-created but flagged for review
 */
export const CatalogStatus = Type.Union([Type.Literal("curated"), Type.Literal("auto"), Type.Literal("pending")], {
	$id: "CatalogStatus",
});
export type CatalogStatus = Static<typeof CatalogStatus>;

/**
 * Identifier kind. Cross-marketplace identifiers (`gtin`, `mpn`) live
 * under `marketplace = "global"`; marketplace-scoped identifiers (eBay
 * `epid`, StockX product id, GOAT id) under that marketplace.
 */
export const ProductIdentifierKind = Type.Union(
	[
		Type.Literal("epid"),
		Type.Literal("gtin"),
		Type.Literal("mpn"),
		Type.Literal("sku"),
		Type.Literal("stockx_id"),
		Type.Literal("goat_id"),
	],
	{ $id: "ProductIdentifierKind" },
);
export type ProductIdentifierKind = Static<typeof ProductIdentifierKind>;

export const ProductIdentifier = Type.Object(
	{
		marketplace: Type.Union([Marketplace, Type.Literal("global")]),
		kind: ProductIdentifierKind,
		value: Type.String({ minLength: 1 }),
		variantId: Type.Optional(Type.String()),
	},
	{ $id: "ProductIdentifier" },
);
export type ProductIdentifier = Static<typeof ProductIdentifier>;

export const ProductVariant = Type.Object(
	{
		id: Type.String(),
		productId: Type.String(),
		variantKey: Type.String({
			description:
				"Canonical aspect string: lower-cased names, alpha-sorted, '|' separated. e.g. 'color:mocha|size:10'.",
		}),
		attributes: Type.Record(Type.String(), Type.String()),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "ProductVariant" },
);
export type ProductVariant = Static<typeof ProductVariant>;

export const Product = Type.Object(
	{
		id: Type.String(),
		title: Type.String(),
		brand: Type.Optional(Type.String()),
		modelNumber: Type.Optional(Type.String()),
		categoryPath: Type.Optional(Type.String()),
		catalogStatus: CatalogStatus,
		attributes: Type.Record(Type.String(), Type.Unknown()),
		hasVariants: Type.Boolean(),
		variants: Type.Optional(Type.Array(ProductVariant)),
		identifiers: Type.Optional(Type.Array(ProductIdentifier)),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "Product" },
);
export type Product = Static<typeof Product>;

/* ------------------------------ ProductRef ------------------------------ */

/**
 * Universal "tell me about a product" input. Three flavors:
 *
 *   - `id`       — already-resolved Product (and optional variant)
 *   - `external` — marketplace listing key (eBay legacy id today). Resolver
 *                  fetches detail, looks up identifiers, auto-creates if
 *                  no match exists.
 *   - `query`    — free-text. Resolver does catalog text search + (if no
 *                  strong match) a one-shot marketplace search to anchor.
 *
 * Hints on `query` mode steer disambiguation without bypassing it —
 * `size: "10"` says "I want a size-10 variant", not "size 10 specifically
 * (skip resolution)".
 */
export const ProductRef = Type.Union(
	[
		Type.Object({
			kind: Type.Literal("id"),
			productId: Type.String({ minLength: 1 }),
			variantId: Type.Optional(Type.String()),
		}),
		Type.Object({
			kind: Type.Literal("external"),
			marketplace: Marketplace,
			listingId: Type.String({
				minLength: 1,
				description: "Marketplace listing key — eBay legacy id, StockX listing id, etc.",
			}),
		}),
		Type.Object({
			kind: Type.Literal("query"),
			q: Type.String({ minLength: 1 }),
			hints: Type.Optional(
				Type.Object({
					size: Type.Optional(Type.String()),
					color: Type.Optional(Type.String()),
					condition: Type.Optional(Type.String()),
					marketplace: Type.Optional(Marketplace),
				}),
			),
		}),
	],
	{ $id: "ProductRef" },
);
export type ProductRef = Static<typeof ProductRef>;

/* ---------------------------- resolve responses ---------------------------- */

/**
 * `POST /v1/products/resolve` outcome. Three terminal states:
 *
 *   - `matched`    — single confident product (and variant when applicable)
 *   - `created`    — no match, resolver auto-created a Product (`auto`
 *                    catalog status). Returned with the same shape as
 *                    `matched` plus `created: true`.
 *   - `ambiguous`  — multiple plausible candidates; caller picks one and
 *                    re-calls with `kind: "id"`. Only for `query` ref kind.
 */
export const ResolveOutcome = Type.Union(
	[
		Type.Object({
			outcome: Type.Literal("matched"),
			product: Product,
			variant: Type.Optional(ProductVariant),
		}),
		Type.Object({
			outcome: Type.Literal("created"),
			product: Product,
			variant: Type.Optional(ProductVariant),
		}),
		Type.Object({
			outcome: Type.Literal("ambiguous"),
			candidates: Type.Array(
				Type.Object({
					product: Product,
					variant: Type.Optional(ProductVariant),
					confidence: Type.Number({ minimum: 0, maximum: 1 }),
					reason: Type.String(),
				}),
			),
		}),
	],
	{ $id: "ResolveOutcome" },
);
export type ResolveOutcome = Static<typeof ResolveOutcome>;

export const ResolveRequest = Type.Object(
	{
		ref: ProductRef,
	},
	{ $id: "ResolveRequest" },
);
export type ResolveRequest = Static<typeof ResolveRequest>;

/* ------------------------------ list / get ------------------------------ */

export const ProductListQuery = Type.Object(
	{
		q: Type.Optional(Type.String()),
		brand: Type.Optional(Type.String()),
		catalogStatus: Type.Optional(CatalogStatus),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	},
	{ $id: "ProductListQuery" },
);
export type ProductListQuery = Static<typeof ProductListQuery>;

export const ProductListResponse = Type.Object(
	{
		products: Type.Array(Product),
		limit: Type.Integer(),
		offset: Type.Integer(),
		total: Type.Optional(Type.Integer()),
	},
	{ $id: "ProductListResponse" },
);
export type ProductListResponse = Static<typeof ProductListResponse>;
