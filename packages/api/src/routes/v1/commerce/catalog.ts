/**
 * eBay Commerce Catalog API mirror — typed `/product/{epid}` and
 * `/product_summary/search` routes.
 *
 *   GET /commerce/catalog/v1_beta/product/{epid}
 *   GET /commerce/catalog/v1_beta/product_summary/search?q=...
 *
 * Transport selected by `selectTransport("markets.catalog")`: REST when
 * `EBAY_CATALOG_APPROVED=1` + app creds, scrape otherwise. Catalog REST
 * is a Limited Release surface eBay denies most apps, so the default
 * deployment serves both reads via scrape — same `CatalogProduct` /
 * `CatalogProductSearchResponse` shapes on the wire.
 */

import {
	CatalogProduct,
	CatalogProductParams,
	CatalogProductSearchResponse,
	CatalogSearchQuery,
} from "@flipagent/types/ebay/commerce";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { CatalogError, getCatalogProduct, searchCatalogProducts } from "../../../services/markets/catalog.js";
import { renderResultHeaders } from "../../../services/shared/headers.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../../utils/openapi.js";

export const ebayCommerceCatalogProductRoute = new Hono();

// /product_summary/search must be declared BEFORE /product/:epid
// because Hono matches in registration order; otherwise `:epid` would
// greedily catch `product_summary/search` (the literal `:epid` segment
// would happily eat any string).
ebayCommerceCatalogProductRoute.get(
	"/product_summary/search",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Search the eBay catalog for products",
		description:
			"Mirror of GET /commerce/catalog/v1_beta/product_summary/search. Accepts the same query parameters as " +
			"eBay (q, gtin, mpn, category_ids, aspect_filter, fieldgroups, limit, offset). Transport auto-selected: " +
			"REST when EBAY_CATALOG_APPROVED is set on this api instance + app creds configured, otherwise scrape. " +
			"The `ProductSearchResponse` shape is identical on the wire across transports. When fieldgroups includes " +
			"FULL or ASPECT_REFINEMENTS, the `refinement` container is computed from the hydrated summaries.",
		parameters: paramsFor("query", CatalogSearchQuery),
		responses: {
			200: jsonResponse("Catalog product search response.", CatalogProductSearchResponse),
			401: errorResponse("Missing or invalid API key."),
			502: errorResponse("Upstream eBay or scrape transport failed."),
			503: errorResponse("Catalog transport unavailable on this api instance."),
		},
	}),
	tbCoerce("query", CatalogSearchQuery),
	async (c) => {
		const query = c.req.valid("query");
		try {
			const result = await searchCatalogProducts(query, {
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			renderResultHeaders(c, result);
			return c.json(result.body);
		} catch (err) {
			if (err instanceof CatalogError) {
				return c.json({ error: err.code, message: err.message }, err.status as 400 | 404 | 502 | 503);
			}
			throw err;
		}
	},
);

ebayCommerceCatalogProductRoute.get(
	"/product/:epid",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get catalog product by EPID",
		description:
			"Mirror of GET /commerce/catalog/v1_beta/product/{epid}. Transport auto-selected: REST when " +
			"EBAY_CATALOG_APPROVED is set on this api instance + app creds configured, otherwise scrape. The " +
			"`Product` shape is identical on the wire across transports.",
		parameters: paramsFor("path", CatalogProductParams),
		responses: {
			200: jsonResponse("Catalog product.", CatalogProduct),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("EPID not found."),
			502: errorResponse("Upstream eBay or scrape transport failed."),
			503: errorResponse("Catalog transport unavailable on this api instance."),
		},
	}),
	tbCoerce("param", CatalogProductParams),
	async (c) => {
		const { epid } = c.req.valid("param");
		try {
			const result = await getCatalogProduct(epid, {
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!result) {
				return c.json({ error: "not_found" as const, message: `EPID ${epid} not found.` }, 404);
			}
			renderResultHeaders(c, result);
			return c.json(result.body);
		} catch (err) {
			if (err instanceof CatalogError) {
				return c.json({ error: err.code, message: err.message }, err.status as 400 | 404 | 502 | 503);
			}
			throw err;
		}
	},
);
