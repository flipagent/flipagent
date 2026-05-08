/**
 * `/v1/products/*` — flipagent-native cross-marketplace Products. The
 * canonical SKU surface; `/v1/marketplaces/ebay/catalog/*` mirrors
 * eBay's authoritative product DB separately.
 *
 *   GET  /v1/products              list (filter by q / brand / status)
 *   GET  /v1/products/{id}         single product (+ identifiers + variants)
 *   POST /v1/products/resolve      ProductRef → Product (or candidates)
 */

import { ProductListQuery, ProductListResponse, ResolveOutcome, ResolveRequest } from "@flipagent/types";
import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { productIdentifiers, products, type productVariants } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import {
	CatalogResolveError,
	getProduct,
	listIdentifiers,
	listVariants,
	resolveProductRef,
} from "../../services/products/index.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const productsRoute = new Hono();

/* ----------------------------- list ----------------------------- */

productsRoute.get(
	"/",
	describeRoute({
		tags: ["Products"],
		summary: "List flipagent catalog products",
		parameters: paramsFor("query", ProductListQuery),
		responses: {
			200: jsonResponse("Product list.", ProductListResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ProductListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const limit = q.limit ?? 50;
		const offset = q.offset ?? 0;
		const conds = [isNull(products.takedownAt)];
		if (q.q) conds.push(ilike(products.title, `%${q.q}%`));
		if (q.brand) conds.push(eq(products.brand, q.brand));
		if (q.catalogStatus) conds.push(eq(products.catalogStatus, q.catalogStatus));
		const rows = await db
			.select()
			.from(products)
			.where(and(...conds))
			.orderBy(desc(products.updatedAt), asc(products.id))
			.limit(limit)
			.offset(offset);
		return c.json({
			products: rows.map(toWireProduct),
			limit,
			offset,
		} satisfies ProductListResponse);
	},
);

/* ----------------------------- get ----------------------------- */

productsRoute.get(
	"/:id",
	describeRoute({
		tags: ["Products"],
		summary: "Get a catalog product (with variants + identifiers)",
		responses: {
			200: { description: "Product." },
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Product not found."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const product = await getProduct(id);
		if (!product || product.takedownAt) {
			return c.json({ error: "product_not_found", message: `No product ${id}.` }, 404);
		}
		const [variants, identifiers] = await Promise.all([listVariants(id), listIdentifiers(id)]);
		return c.json({
			...toWireProduct(product),
			variants: variants.map(toWireVariant),
			identifiers: identifiers.map((row) => ({
				marketplace: row.marketplace,
				kind: row.kind,
				value: row.value,
				...(row.variantId ? { variantId: row.variantId } : {}),
			})),
		});
	},
);

/* ----------------------------- resolve ----------------------------- */

productsRoute.post(
	"/resolve",
	describeRoute({
		tags: ["Products"],
		summary: "Resolve a ProductRef to a flipagent product",
		description:
			"Three input modes — `id` (direct lookup), `external` (marketplace listing → identifiers index → auto-create on miss), `query` (catalog text search → marketplace anchor → auto-create on miss). Returns `matched`, `created`, or `ambiguous` (with candidates for caller to pick).",
		responses: {
			200: jsonResponse("Resolution outcome.", ResolveOutcome),
			400: errorResponse("Empty / invalid query."),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Could not resolve."),
		},
	}),
	requireApiKey,
	tbBody(ResolveRequest),
	async (c) => {
		const body = c.req.valid("json");
		try {
			const result = await resolveProductRef(body.ref as never, { apiKey: c.var.apiKey });
			if (result.outcome === "ambiguous") {
				return c.json({
					outcome: "ambiguous" as const,
					candidates: (result.candidates ?? []).map((cand) => ({
						product: toWireProduct(cand.product),
						...(cand.variant ? { variant: toWireVariant(cand.variant) } : {}),
						confidence: cand.confidence,
						reason: cand.reason,
					})),
				});
			}
			if (!result.product) {
				return c.json({ error: "no_match", message: "No product resolved." }, 404);
			}
			return c.json({
				outcome: result.outcome,
				product: toWireProduct(result.product),
				...(result.variant ? { variant: toWireVariant(result.variant) } : {}),
			});
		} catch (err) {
			if (err instanceof CatalogResolveError) {
				return c.json({ error: err.code, message: err.message }, err.status as 400 | 404);
			}
			throw err;
		}
	},
);

/* ----------------------------- helpers ----------------------------- */

function toWireProduct(row: typeof products.$inferSelect) {
	return {
		id: row.id,
		title: row.title,
		brand: row.brand ?? undefined,
		modelNumber: row.modelNumber ?? undefined,
		categoryPath: row.categoryPath ?? undefined,
		catalogStatus: row.catalogStatus as "curated" | "auto" | "pending",
		attributes: row.attributes as Record<string, unknown>,
		hasVariants: row.hasVariants,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toWireVariant(row: typeof productVariants.$inferSelect) {
	return {
		id: row.id,
		productId: row.productId,
		variantKey: row.variantKey,
		attributes: row.attributes as Record<string, string>,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

// Suppress unused import warning — productIdentifiers is reachable via
// `listIdentifiers` but the `typeof` form keeps it referenced.
void productIdentifiers;
