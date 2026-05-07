/**
 * `/v1/listings/bulk/*` — bulk listing operations.
 * Wraps eBay sell/inventory bulk endpoints + sell/inventory/inventory_item_group.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Money } from "./_common.js";
import { ListingAspects, ListingCondition, ListingPolicies } from "./listings.js";

/* ----- bulk price/quantity update ------------------------------------ */

export const ListingBulkPriceUpdate = Type.Object(
	{
		updates: Type.Array(
			Type.Object({
				sku: Type.String(),
				price: Type.Optional(Money),
				quantity: Type.Optional(Type.Integer({ minimum: 0 })),
				offerId: Type.Optional(Type.String()),
			}),
			{ minItems: 1, maxItems: 25 },
		),
	},
	{ $id: "ListingBulkPriceUpdate" },
);
export type ListingBulkPriceUpdate = Static<typeof ListingBulkPriceUpdate>;

/* ----- bulk create-or-replace ---------------------------------------- */

export const ListingBulkUpsert = Type.Object(
	{
		items: Type.Array(
			Type.Object({
				sku: Type.String(),
				title: Type.String(),
				description: Type.Optional(Type.String()),
				price: Money,
				quantity: Type.Integer({ minimum: 0 }),
				condition: ListingCondition,
				categoryId: Type.String(),
				images: Type.Array(Type.String(), { minItems: 1 }),
				aspects: Type.Optional(ListingAspects),
				policies: Type.Optional(ListingPolicies),
				merchantLocationKey: Type.Optional(Type.String()),
			}),
			{ minItems: 1, maxItems: 25 },
		),
	},
	{ $id: "ListingBulkUpsert" },
);
export type ListingBulkUpsert = Static<typeof ListingBulkUpsert>;

/* ----- bulk publish -------------------------------------------------- */

export const ListingBulkPublish = Type.Object(
	{
		offerIds: Type.Array(Type.String(), { minItems: 1, maxItems: 25 }),
	},
	{ $id: "ListingBulkPublish" },
);
export type ListingBulkPublish = Static<typeof ListingBulkPublish>;

export const ListingBulkResult = Type.Object(
	{
		responses: Type.Array(
			Type.Object({
				sku: Type.Optional(Type.String()),
				offerId: Type.Optional(Type.String()),
				listingId: Type.Optional(Type.String()),
				statusCode: Type.Integer(),
				errors: Type.Optional(
					Type.Array(Type.Object({ errorId: Type.Optional(Type.Integer()), message: Type.String() })),
				),
			}),
		),
	},
	{ $id: "ListingBulkResult" },
);
export type ListingBulkResult = Static<typeof ListingBulkResult>;

/* ----- inventory_item_group (multi-variation parent) ----------------- */

export const ListingGroup = Type.Object(
	{
		id: Type.String({ description: "inventoryItemGroupKey." }),
		title: Type.String(),
		description: Type.Optional(Type.String()),
		images: Type.Array(Type.String()),
		variantSkus: Type.Array(Type.String()),
		variesBy: Type.Optional(
			Type.Object({
				// Per eBay `Specification` spec each entry is `{name, values}`.
				// Verified live 2026-05-03 — passing bare strings was rejected
				// with "The request has errors" (silent shape mismatch).
				specifications: Type.Array(
					Type.Object({
						name: Type.String({ description: "Aspect name (e.g. 'Size', 'Color')." }),
						values: Type.Array(Type.String(), { description: "All variation values for this aspect." }),
					}),
				),
				aspectsImageVariesBy: Type.Optional(Type.Array(Type.String())),
				images: Type.Optional(
					Type.Array(
						Type.Object({
							specification: Type.String(),
							value: Type.String(),
							imageUrls: Type.Array(Type.String()),
						}),
					),
				),
			}),
		),
		aspects: Type.Optional(ListingAspects),
		// `brand`, `mpn`, `gtin` belong to per-SKU `inventory_item` records,
		// NOT to the parent `inventory_item_group`. eBay's
		// `InventoryItemGroup` schema (verified 2026-05-03 via field-diff)
		// only carries: aspects, description, imageUrls, inventoryItemGroupKey,
		// subtitle, title, variantSKUs, variesBy, videoIds. Reading per-SKU
		// brand/mpn/gtin from the group endpoint would always be undefined.
		// Read them from the linked SKU's inventory_item instead.
		subtitle: Type.Optional(Type.String()),
		videoIds: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "ListingGroup" },
);
export type ListingGroup = Static<typeof ListingGroup>;

export const ListingGroupUpsert = Type.Object(
	{
		title: Type.String(),
		description: Type.Optional(Type.String()),
		images: Type.Array(Type.String(), { minItems: 1 }),
		variantSkus: Type.Array(Type.String(), { minItems: 1 }),
		variesBy: Type.Optional(
			Type.Object({
				specifications: Type.Array(Type.String()),
				aspectsImageVariesBy: Type.Optional(Type.Array(Type.String())),
				images: Type.Optional(
					Type.Array(
						Type.Object({
							specification: Type.String(),
							value: Type.String(),
							imageUrls: Type.Array(Type.String()),
						}),
					),
				),
			}),
		),
		aspects: Type.Optional(ListingAspects),
		// See ListingGroup above — group has no brand/mpn/gtin in eBay's
		// schema. Adding them to the upsert body would silently get dropped.
		subtitle: Type.Optional(Type.String()),
		videoIds: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "ListingGroupUpsert" },
);
export type ListingGroupUpsert = Static<typeof ListingGroupUpsert>;

/* ----- migrate (Trading listing → inventory) ------------------------- */

export const ListingMigrate = Type.Object(
	{
		legacyListingIds: Type.Array(Type.String(), { minItems: 1, maxItems: 5 }),
	},
	{ $id: "ListingMigrate" },
);
export type ListingMigrate = Static<typeof ListingMigrate>;

export const ListingMigrateResult = Type.Object(
	{
		responses: Type.Array(
			Type.Object({
				legacyItemId: Type.String(),
				inventoryItemSku: Type.Optional(Type.String()),
				offerId: Type.Optional(Type.String()),
				statusCode: Type.Integer(),
				errors: Type.Optional(Type.Array(Type.Object({ message: Type.String() }))),
			}),
		),
	},
	{ $id: "ListingMigrateResult" },
);
export type ListingMigrateResult = Static<typeof ListingMigrateResult>;

/* ----- bulk read inventory + offer ----------------------------------- */

export const BulkInventoryGet = Type.Object(
	{ skus: Type.Array(Type.String(), { minItems: 1, maxItems: 25 }) },
	{ $id: "BulkInventoryGet" },
);
export type BulkInventoryGet = Static<typeof BulkInventoryGet>;

export const BulkOfferGet = Type.Object(
	{ offerIds: Type.Array(Type.String(), { minItems: 1, maxItems: 25 }) },
	{ $id: "BulkOfferGet" },
);
export type BulkOfferGet = Static<typeof BulkOfferGet>;
