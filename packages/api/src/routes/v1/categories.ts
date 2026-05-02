/**
 * `/v1/categories` — taxonomy tree + suggestions + per-category aspects.
 */

import {
	CategoriesListQuery,
	CategoriesListResponse,
	CategoryAspectsResponse,
	CategorySuggestQuery,
	CategorySuggestResponse,
	CompatibilityPropertiesResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getCategoryAspects, getCategoryChildren, suggestCategory } from "../../services/categories.js";
import { getCompatibilityProperties } from "../../services/compatibility.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const categoriesRoute = new Hono();

const COMMON = { 401: errorResponse("API key missing."), 502: errorResponse("Upstream eBay failed.") };

categoriesRoute.get(
	"/suggest",
	describeRoute({
		tags: ["Categories"],
		summary: "Suggest a category from a listing title",
		parameters: paramsFor("query", CategorySuggestQuery),
		responses: { 200: jsonResponse("Suggestions.", CategorySuggestResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", CategorySuggestQuery),
	async (c) => {
		const q = c.req.valid("query");
		const suggestions = await suggestCategory(q.title, q.marketplace);
		return c.json({ suggestions, source: "rest" as const } satisfies CategorySuggestResponse);
	},
);

categoriesRoute.get(
	"/:id/compatibility-properties",
	describeRoute({
		tags: ["Categories"],
		summary: "Compatibility properties for a category",
		responses: { 200: jsonResponse("Properties.", CompatibilityPropertiesResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const treeId = c.req.query("categoryTreeId") ?? "0";
		return c.json({
			...(await getCompatibilityProperties(c.req.param("id"), treeId)),
			source: "rest" as const,
		});
	},
);

categoriesRoute.get(
	"/:id/aspects",
	describeRoute({
		tags: ["Categories"],
		summary: "Required + recommended item-specifics for a category",
		responses: { 200: jsonResponse("Aspects.", CategoryAspectsResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const aspects = await getCategoryAspects(id);
		return c.json({ categoryId: id, aspects, source: "rest" as const } satisfies CategoryAspectsResponse);
	},
);

categoriesRoute.get(
	"/",
	describeRoute({
		tags: ["Categories"],
		summary: "List categories (top-level or children of `parentId`)",
		parameters: paramsFor("query", CategoriesListQuery),
		responses: { 200: jsonResponse("Categories.", CategoriesListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", CategoriesListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const categories = await getCategoryChildren(q.parentId, q.marketplace);
		return c.json({ categories, source: "rest" as const } satisfies CategoriesListResponse);
	},
);
