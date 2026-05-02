/**
 * `/v1/listings/bulk/*` — bulk listing operations.
 * Wraps eBay sell/inventory bulk endpoints + sell/inventory/inventory_item_group.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Money, ResponseSource } from "./_common.js";
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
		source: Type.Optional(ResponseSource),
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
				specifications: Type.Array(Type.String(), {
					description: "Aspect names that differ across variants (e.g. ['Size','Color']).",
				}),
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
		brand: Type.Optional(Type.String()),
		mpn: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.String()),
		source: Type.Optional(ResponseSource),
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
		brand: Type.Optional(Type.String()),
		mpn: Type.Optional(Type.String()),
		gtin: Type.Optional(Type.String()),
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
		source: Type.Optional(ResponseSource),
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
