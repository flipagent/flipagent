/**
 * `/v1/store` — eBay Stores configuration (categories tree).
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

export const StoreCategory = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		parentId: Type.Optional(Type.String()),
		listingCount: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ $id: "StoreCategory" },
);
export type StoreCategory = Static<typeof StoreCategory>;

export const StoreCategoriesResponse = Type.Object(
	{ categories: Type.Array(StoreCategory), source: Type.Optional(ResponseSource) },
	{ $id: "StoreCategoriesResponse" },
);
export type StoreCategoriesResponse = Static<typeof StoreCategoriesResponse>;

export const StoreCategoryUpsert = Type.Object(
	{
		categories: Type.Array(
			Type.Object({
				name: Type.String(),
				parentId: Type.Optional(Type.String()),
			}),
		),
	},
	{ $id: "StoreCategoryUpsert" },
);
export type StoreCategoryUpsert = Static<typeof StoreCategoryUpsert>;
