/**
 * `/v1/sales/*` — orders received as a seller. Wraps eBay
 * sell/fulfillment with cents-int Money + 5-state lifecycle.
 */

import { SaleRefundRequest, SaleResponse, SaleShipRequest, SalesListQuery, SalesListResponse } from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { EbayApiError } from "../../services/ebay/rest/user-client.js";
import { getSale, listSales, refundSale, shipSale } from "../../services/sales/operations.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const salesRoute = new Hono();

const COMMON = {
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset."),
};

function mapErr(c: Context, err: unknown) {
	if (err instanceof EbayApiError) {
		return c.json({ error: err.code, message: err.message }, err.status as 401 | 404 | 502 | 503);
	}
	return null;
}

salesRoute.get(
	"/",
	describeRoute({
		tags: ["Sales"],
		summary: "List my sales (orders received)",
		parameters: paramsFor("query", SalesListQuery),
		responses: { 200: jsonResponse("Sales page.", SalesListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", SalesListQuery),
	async (c) => {
		const q = c.req.valid("query");
		try {
			const r = await listSales(
				{ limit: q.limit, offset: q.offset },
				{
					apiKeyId: c.var.apiKey.id,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
				},
			);
			const filtered = q.status ? r.sales.filter((s) => s.status === q.status) : r.sales;
			return c.json({
				sales: filtered,
				limit: r.limit,
				offset: r.offset,
				...(r.total !== undefined ? { total: r.total } : {}),
				source: "rest" as const,
			} satisfies SalesListResponse);
		} catch (err) {
			const mapped = mapErr(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

salesRoute.get(
	"/:id",
	describeRoute({
		tags: ["Sales"],
		summary: "Get a sale",
		responses: { 200: jsonResponse("Sale.", SaleResponse), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		try {
			const sale = await getSale(c.req.param("id"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!sale) return c.json({ error: "sale_not_found", message: "No sale" }, 404);
			return c.json(sale);
		} catch (err) {
			const mapped = mapErr(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

salesRoute.post(
	"/:id/ship",
	describeRoute({
		tags: ["Sales"],
		summary: "Mark shipped + tracking",
		responses: { 200: jsonResponse("Updated sale.", SaleResponse), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	tbBody(SaleShipRequest),
	async (c) => {
		try {
			const sale = await shipSale(c.req.param("id"), c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!sale) return c.json({ error: "sale_not_found", message: "No sale" }, 404);
			return c.json(sale);
		} catch (err) {
			const mapped = mapErr(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

salesRoute.post(
	"/:id/refund",
	describeRoute({
		tags: ["Sales"],
		summary: "Issue refund",
		responses: { 200: jsonResponse("Updated sale.", SaleResponse), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	tbBody(SaleRefundRequest),
	async (c) => {
		try {
			const sale = await refundSale(c.req.param("id"), c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!sale) return c.json({ error: "sale_not_found", message: "No sale" }, 404);
			return c.json(sale);
		} catch (err) {
			const mapped = mapErr(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);
