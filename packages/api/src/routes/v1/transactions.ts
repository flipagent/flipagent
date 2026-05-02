/**
 * `/v1/transactions` — sell/finances transactions (sale, refund, dispute, payout).
 */

import { TransactionsListQuery, TransactionsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { listTransactions } from "../../services/money/operations.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const transactionsRoute = new Hono();

const COMMON = {
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset."),
};

transactionsRoute.get(
	"/",
	describeRoute({
		tags: ["Money"],
		summary: "List transactions",
		parameters: paramsFor("query", TransactionsListQuery),
		responses: { 200: jsonResponse("Transactions page.", TransactionsListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", TransactionsListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listTransactions(q, {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({
			transactions: r.transactions,
			limit: r.limit,
			offset: r.offset,
			...(r.total !== undefined ? { total: r.total } : {}),
			source: "rest" as const,
		} satisfies TransactionsListResponse);
	},
);
