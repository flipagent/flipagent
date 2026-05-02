/**
 * `/v1/expenses/*` — append-only cost-side event log + aggregated
 * cost summary. Records what eBay's Finances API doesn't know
 * (acquisition, forwarder fees, external expenses); sales / refunds /
 * eBay fees come from `/v1/payouts` + `/v1/transactions`.
 *
 *   POST /v1/expenses/record    — append one cost event
 *   GET  /v1/expenses/summary   — aggregated cost metrics over the window
 *
 * Owner-scoped: events written by any of the user's API keys roll up
 * into one expense ledger.
 */

import { ExpenseRecordRequest, ExpenseRecordResponse, ExpenseSummaryResponse } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { DEFAULT_WINDOW_DAYS, record, summary } from "../../services/expenses.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const expensesRoute = new Hono();

const SummaryQuery = Type.Object(
	{
		windowDays: Type.Optional(
			Type.Integer({ minimum: 1, maximum: 365, description: "Days back from now. Default 30." }),
		),
	},
	{ $id: "ExpenseSummaryQuery" },
);

expensesRoute.post(
	"/record",
	describeRoute({
		tags: ["Expenses"],
		summary: "Append one cost event (purchased | forwarder_fee | expense)",
		description:
			"Records an acquisition cost, forwarder bill, or external expense. eBay-side cash flow (sales, refunds, final-value fees, payment processing fees) is read from `/v1/payouts` + `/v1/transactions` — don't double-record those here. `amountCents` is always a positive magnitude. For `purchased` events, set `payload.predictedNetCents` (and optionally `payload.predictedDaysToSell`) to preserve evaluate()'s prediction for the future calibration loop.",
		responses: {
			201: jsonResponse("Event recorded.", ExpenseRecordResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(ExpenseRecordRequest),
	async (c) => {
		const body = c.req.valid("json");
		const apiKey = c.var.apiKey;
		const event = await record(apiKey, body);
		return c.json(event, 201);
	},
);

expensesRoute.get(
	"/summary",
	describeRoute({
		tags: ["Expenses"],
		summary: "Aggregated cost-side metrics for the window",
		description:
			"Counts per kind + cost totals (acquisition + forwarder + expense). For full P&L (revenue, ROI, win rate, predicted-vs-actual calibration), join with `/v1/transactions` over the same window — match the lineItem's SKU to the SKU on your purchased events.",
		parameters: paramsFor("query", SummaryQuery),
		responses: {
			200: jsonResponse("Cost summary.", ExpenseSummaryResponse),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbCoerce("query", SummaryQuery),
	async (c) => {
		const { windowDays } = c.req.valid("query");
		const apiKey = c.var.apiKey;
		const result = await summary(apiKey, windowDays ?? DEFAULT_WINDOW_DAYS);
		return c.json(result);
	},
);
