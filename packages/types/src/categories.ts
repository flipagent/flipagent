/**
 * `/v1/categories` — read-only marketplace category tree + suggestions
 * + per-category aspects. eBay's commerce/taxonomy surface, normalized.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, ResponseSource } from "./_common.js";

export const CategoryNode = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		path: Type.Optional(Type.String()),
		parentId: Type.Optional(Type.String()),
		isLeaf: Type.Optional(Type.Boolean()),
	},
	{ $id: "CategoryNode" },
);
export type CategoryNode = Static<typeof CategoryNode>;

export const CategoriesListQuery = Type.Object(
	{
		marketplace: Type.Optional(Marketplace),
		parentId: Type.Optional(Type.String({ description: "Return children of this category." })),
	},
	{ $id: "CategoriesListQuery" },
);
export type CategoriesListQuery = Static<typeof CategoriesListQuery>;

export const CategoriesListResponse = Type.Object(
	{
		categories: Type.Array(CategoryNode),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "CategoriesListResponse" },
);
export type CategoriesListResponse = Static<typeof CategoriesListResponse>;

export const CategorySuggestQuery = Type.Object(
	{
		title: Type.String({ minLength: 1 }),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "CategorySuggestQuery" },
);
export type CategorySuggestQuery = Static<typeof CategorySuggestQuery>;

export const CategorySuggestion = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		path: Type.Optional(Type.String()),
		confidence: Type.Optional(Type.Number()),
	},
	{ $id: "CategorySuggestion" },
);
export type CategorySuggestion = Static<typeof CategorySuggestion>;

export const CategorySuggestResponse = Type.Object(
	{
		suggestions: Type.Array(CategorySuggestion),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "CategorySuggestResponse" },
);
export type CategorySuggestResponse = Static<typeof CategorySuggestResponse>;

export const CategoryAspect = Type.Object(
	{
		name: Type.String(),
		required: Type.Boolean(),
		multiValued: Type.Boolean(),
		dataType: Type.Optional(Type.String({ description: "STRING | NUMBER | DATE | …" })),
		values: Type.Optional(Type.Array(Type.String(), { description: "Suggested or enumerated values." })),
	},
	{ $id: "CategoryAspect" },
);
export type CategoryAspect = Static<typeof CategoryAspect>;

export const CategoryAspectsResponse = Type.Object(
	{
		categoryId: Type.String(),
		aspects: Type.Array(CategoryAspect),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "CategoryAspectsResponse" },
);
export type CategoryAspectsResponse = Static<typeof CategoryAspectsResponse>;

/**
 * `fetch_item_aspects` — bulk download of every aspect for every category
 * in a tree. Heavyweight (multi-MB JSON for full eBay US tree); use
 * `getCategoryAspects` for one category in real-time UIs.
 */
export const CategoryFetchItemAspectsResponse = Type.Object(
	{
		treeId: Type.String(),
		entries: Type.Array(
			Type.Object({
				categoryId: Type.String(),
				aspects: Type.Array(CategoryAspect),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "CategoryFetchItemAspectsResponse" },
);
export type CategoryFetchItemAspectsResponse = Static<typeof CategoryFetchItemAspectsResponse>;
