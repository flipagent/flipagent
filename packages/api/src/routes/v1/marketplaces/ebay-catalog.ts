/**
 * `/v1/marketplaces/ebay/catalog/*` — eBay's product catalog mirror,
 * keyed on EPID. A pass-through view of eBay's authoritative product DB,
 * useful for filling `aspects` correctly before listing or pulling a
 * canonical title / GTIN / MPN tuple. Distinct from `/v1/products/*`
 * (flipagent's native cross-marketplace Products surface).
 *
 *   GET /v1/marketplaces/ebay/catalog/{epid}              single product
 *   GET /v1/marketplaces/ebay/catalog/search              REST-only (Limited Release)
 *   GET /v1/marketplaces/ebay/catalog/metadata            aspects for an EPID or category
 *   GET /v1/marketplaces/ebay/catalog/category-metadata   aspects for many categories
 *
 * Transport selection lives in `services/ebay/catalog.ts` via
 * `selectTransport("markets.catalog", ...)`. The route just unwraps
 * the `FlipagentResult` envelope and renders source headers.
 */

import {
	EbayCatalogListResponse,
	EbayCatalogMetadataForCategoriesQuery,
	EbayCatalogMetadataForCategoriesResponse,
	EbayCatalogMetadataQuery,
	EbayCatalogMetadataResponse,
	EbayCatalogProductResponse,
	EbayCatalogSearchQuery,
} from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../../middleware/auth.js";
import {
	EbayCatalogError,
	getEbayCatalogByEpid,
	getEbayCatalogMetadata,
	getEbayCatalogMetadataForCategories,
	searchEbayCatalog,
} from "../../../services/ebay/catalog.js";
import { renderResultHeaders } from "../../../services/shared/headers.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../../utils/openapi.js";

export const ebayCatalogRoute = new Hono();

function mapEbayCatalogError(c: Context, err: unknown) {
	if (err instanceof EbayCatalogError) {
		return c.json({ error: err.code, message: err.message }, err.status as 400 | 404 | 412 | 502 | 503);
	}
	return null;
}

ebayCatalogRoute.get(
	"/search",
	describeRoute({
		tags: ["EbayCatalog"],
		summary: "Search the universal product catalog",
		parameters: paramsFor("query", EbayCatalogSearchQuery),
		responses: {
			200: jsonResponse("Products.", EbayCatalogListResponse),
			503: errorResponse(
				"Catalog search not available on this server (needs a connected eBay account or operator approval).",
			),
		},
	}),
	requireApiKey,
	tbCoerce("query", EbayCatalogSearchQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await searchEbayCatalog(q, c.var.apiKey.id);
			renderResultHeaders(c, result);
			const body: EbayCatalogListResponse = {
				products: result.body.products,
				limit: result.body.limit,
				offset: result.body.offset,
				...(result.body.total !== undefined ? { total: result.body.total } : {}),
			};
			return c.json(body);
		} catch (err) {
			const mapped = mapEbayCatalogError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

ebayCatalogRoute.get(
	"/metadata",
	describeRoute({
		tags: ["EbayCatalog"],
		summary: "Aspect metadata for an EPID or category",
		description:
			"Wraps `get_product_metadata`. Returns required + recommended aspects so agents can fill `aspects` correctly before listing.",
		parameters: paramsFor("query", EbayCatalogMetadataQuery),
		responses: {
			200: jsonResponse("Metadata.", EbayCatalogMetadataResponse),
			400: errorResponse("Provide ?epid= or ?categoryId=."),
			503: errorResponse(
				"Catalog metadata not available on this server (needs a connected eBay account or operator approval).",
			),
		},
	}),
	requireApiKey,
	tbCoerce("query", EbayCatalogMetadataQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await getEbayCatalogMetadata(q, c.var.apiKey.id);
			renderResultHeaders(c, result);
			return c.json(result.body satisfies EbayCatalogMetadataResponse);
		} catch (err) {
			const mapped = mapEbayCatalogError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

ebayCatalogRoute.get(
	"/category-metadata",
	describeRoute({
		tags: ["EbayCatalog"],
		summary: "Aspect metadata for many categories in one call",
		description:
			"Wraps `get_product_metadata_for_categories`. Bulk variant of `/metadata` — pass `?categoryIds=a,b,c`.",
		parameters: paramsFor("query", EbayCatalogMetadataForCategoriesQuery),
		responses: {
			200: jsonResponse("Metadata.", EbayCatalogMetadataForCategoriesResponse),
			503: errorResponse(
				"Catalog metadata not available on this server (needs a connected eBay account or operator approval).",
			),
		},
	}),
	requireApiKey,
	tbCoerce("query", EbayCatalogMetadataForCategoriesQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await getEbayCatalogMetadataForCategories(q, c.var.apiKey.id);
			renderResultHeaders(c, result);
			return c.json(result.body satisfies EbayCatalogMetadataForCategoriesResponse);
		} catch (err) {
			const mapped = mapEbayCatalogError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

ebayCatalogRoute.get(
	"/:epid",
	describeRoute({
		tags: ["EbayCatalog"],
		summary: "Get a product by EPID",
		description:
			"Resolves a product by EPID using whichever sources the server has available — connected-seller Catalog REST, app-credential REST when the operator has approval, and finally a public JSON-LD scrape.",
		responses: {
			200: jsonResponse("Product.", EbayCatalogProductResponse),
			404: errorResponse("EPID not found."),
			503: errorResponse("No catalog transport available (REST + scrape both failed)."),
		},
	}),
	requireApiKey,
	async (c) => {
		try {
			const result = await getEbayCatalogByEpid(c.req.param("epid"), undefined, c.var.apiKey.id);
			if (!result) return c.json({ error: "product_not_found", message: "No product." }, 404);
			renderResultHeaders(c, result);
			return c.json(result.body);
		} catch (err) {
			const mapped = mapEbayCatalogError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);
