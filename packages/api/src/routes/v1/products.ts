/**
 * `/v1/products` — universal product catalog (eBay EPID).
 *
 *   GET /v1/products/{epid}     single product (REST when approved, else scrape)
 *   GET /v1/products/search     REST-only (Limited Release)
 *
 * Transport selection lives in `services/products.ts` via
 * `selectTransport("markets.catalog", ...)`. The route just unwraps
 * the `FlipagentResult` envelope and renders source headers.
 */

import {
	ProductMetadataForCategoriesQuery,
	ProductMetadataForCategoriesResponse,
	ProductMetadataQuery,
	ProductMetadataResponse,
	ProductResponse,
	ProductSearchQuery,
	ProductsListResponse,
} from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	getProductByEpid,
	getProductMetadata,
	getProductMetadataForCategories,
	ProductsError,
	searchProducts,
} from "../../services/products.js";
import { renderResultHeaders } from "../../services/shared/headers.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const productsRoute = new Hono();

function mapProductsError(c: Context, err: unknown) {
	if (err instanceof ProductsError) {
		return c.json({ error: err.code, message: err.message }, err.status as 400 | 404 | 412 | 502 | 503);
	}
	return null;
}

productsRoute.get(
	"/search",
	describeRoute({
		tags: ["Products"],
		summary: "Search the universal product catalog",
		parameters: paramsFor("query", ProductSearchQuery),
		responses: {
			200: jsonResponse("Products.", ProductsListResponse),
			503: errorResponse(
				"Catalog search not available on this server (needs a connected eBay account or operator approval).",
			),
		},
	}),
	requireApiKey,
	tbCoerce("query", ProductSearchQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await searchProducts(q, c.var.apiKey.id);
			renderResultHeaders(c, result);
			const body: ProductsListResponse = {
				products: result.body.products,
				limit: result.body.limit,
				offset: result.body.offset,
				...(result.body.total !== undefined ? { total: result.body.total } : {}),
			};
			return c.json(body);
		} catch (err) {
			const mapped = mapProductsError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

productsRoute.get(
	"/metadata",
	describeRoute({
		tags: ["Products"],
		summary: "Aspect metadata for an EPID or category",
		description:
			"Wraps `get_product_metadata`. Returns required + recommended aspects so agents can fill `aspects` correctly before listing.",
		parameters: paramsFor("query", ProductMetadataQuery),
		responses: {
			200: jsonResponse("Metadata.", ProductMetadataResponse),
			400: errorResponse("Provide ?epid= or ?categoryId=."),
			503: errorResponse(
				"Catalog metadata not available on this server (needs a connected eBay account or operator approval).",
			),
		},
	}),
	requireApiKey,
	tbCoerce("query", ProductMetadataQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await getProductMetadata(q, c.var.apiKey.id);
			renderResultHeaders(c, result);
			return c.json(result.body satisfies ProductMetadataResponse);
		} catch (err) {
			const mapped = mapProductsError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

productsRoute.get(
	"/category-metadata",
	describeRoute({
		tags: ["Products"],
		summary: "Aspect metadata for many categories in one call",
		description:
			"Wraps `get_product_metadata_for_categories`. Bulk variant of `/metadata` — pass `?categoryIds=a,b,c`.",
		parameters: paramsFor("query", ProductMetadataForCategoriesQuery),
		responses: {
			200: jsonResponse("Metadata.", ProductMetadataForCategoriesResponse),
			503: errorResponse(
				"Catalog metadata not available on this server (needs a connected eBay account or operator approval).",
			),
		},
	}),
	requireApiKey,
	tbCoerce("query", ProductMetadataForCategoriesQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await getProductMetadataForCategories(q, c.var.apiKey.id);
			renderResultHeaders(c, result);
			return c.json(result.body satisfies ProductMetadataForCategoriesResponse);
		} catch (err) {
			const mapped = mapProductsError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

productsRoute.get(
	"/:epid",
	describeRoute({
		tags: ["Products"],
		summary: "Get a product by EPID",
		description:
			"Resolves a product by EPID using whichever sources the server has available — connected-seller Catalog REST, app-credential REST when the operator has approval, and finally a public JSON-LD scrape.",
		responses: {
			200: jsonResponse("Product.", ProductResponse),
			404: errorResponse("EPID not found."),
			503: errorResponse("No catalog transport available (REST + scrape both failed)."),
		},
	}),
	requireApiKey,
	async (c) => {
		try {
			const result = await getProductByEpid(c.req.param("epid"), undefined, c.var.apiKey.id);
			if (!result) return c.json({ error: "product_not_found", message: "No product." }, 404);
			renderResultHeaders(c, result);
			return c.json(result.body);
		} catch (err) {
			const mapped = mapProductsError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);
