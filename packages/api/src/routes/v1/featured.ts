/**
 * `/v1/featured` — eBay-curated buy-side surfaces:
 *   - daily / event deals (Buy Deal)
 *   - merchandised products (Buy Marketing — best-selling per category)
 *   - also-bought / also-viewed (Buy Marketing — related products)
 *
 * All read-mostly buyer-facing. The seller-facing `/v1/recommendations`
 * is the inverse: listing-optimization tips for the caller's listings.
 */

import {
	FeaturedListResponse,
	MerchandisedProductsQuery,
	MerchandisedProductsResponse,
	RelatedByProductQuery,
	RelatedByProductResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	listAlsoBoughtByProduct,
	listAlsoViewedByProduct,
	listFeatured,
	listMerchandisedProducts,
} from "../../services/featured.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const featuredRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

featuredRoute.get(
	"/",
	describeRoute({
		tags: ["Featured"],
		summary: "List eBay's curated daily deals",
		responses: { 200: jsonResponse("Deals.", FeaturedListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const kind = (c.req.query("kind") as "daily_deal" | "event_deal" | undefined) ?? "daily_deal";
		const r = await listFeatured(kind, {
			limit: Number(c.req.query("limit") ?? 50),
			offset: Number(c.req.query("offset") ?? 0),
			categoryIds: c.req.query("categoryIds"),
		});
		return c.json({ ...r });
	},
);

featuredRoute.get(
	"/merchandised",
	describeRoute({
		tags: ["Featured"],
		summary: "Best-selling products in a category (Buy Marketing, LR)",
		parameters: paramsFor("query", MerchandisedProductsQuery),
		responses: { 200: jsonResponse("Products.", MerchandisedProductsResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", MerchandisedProductsQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listMerchandisedProducts(q, ebayMarketplaceId());
		return c.json({ ...r } satisfies MerchandisedProductsResponse);
	},
);

featuredRoute.get(
	"/also-bought",
	describeRoute({
		tags: ["Featured"],
		summary: "Products often bought together with this EPID/GTIN (LR)",
		parameters: paramsFor("query", RelatedByProductQuery),
		responses: { 200: jsonResponse("Products.", RelatedByProductResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", RelatedByProductQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listAlsoBoughtByProduct(q, ebayMarketplaceId());
		return c.json({ ...r } satisfies RelatedByProductResponse);
	},
);

featuredRoute.get(
	"/also-viewed",
	describeRoute({
		tags: ["Featured"],
		summary: "Products often viewed alongside this EPID/GTIN (LR)",
		parameters: paramsFor("query", RelatedByProductQuery),
		responses: { 200: jsonResponse("Products.", RelatedByProductResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", RelatedByProductQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listAlsoViewedByProduct(q, ebayMarketplaceId());
		return c.json({ ...r } satisfies RelatedByProductResponse);
	},
);
