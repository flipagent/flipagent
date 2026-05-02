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

import { ProductResponse, ProductSearchQuery, ProductsListResponse } from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getProductByEpid, ProductsError, searchProducts } from "../../services/products.js";
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
			503: errorResponse("Set EBAY_CATALOG_APPROVED=1 after eBay tenant approval."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ProductSearchQuery),
	async (c) => {
		try {
			const q = c.req.valid("query");
			const result = await searchProducts(q);
			renderResultHeaders(c, result);
			const body: ProductsListResponse = {
				products: result.body.products,
				limit: result.body.limit,
				offset: result.body.offset,
				...(result.body.total !== undefined ? { total: result.body.total } : {}),
				source: result.source,
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
	"/:epid",
	describeRoute({
		tags: ["Products"],
		summary: "Get a product by EPID",
		description:
			"Works in any tenant. `selectTransport` picks REST when `EBAY_CATALOG_APPROVED=1` + app creds are configured; otherwise scrapes `/p/{epid}` JSON-LD. `X-Flipagent-Source` says which path served the response.",
		responses: {
			200: jsonResponse("Product.", ProductResponse),
			404: errorResponse("EPID not found."),
			503: errorResponse("Catalog REST not approved and no scrape transport available."),
		},
	}),
	requireApiKey,
	async (c) => {
		try {
			const result = await getProductByEpid(c.req.param("epid"));
			if (!result) return c.json({ error: "product_not_found", message: "No product." }, 404);
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source });
		} catch (err) {
			const mapped = mapProductsError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);
