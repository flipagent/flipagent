/**
 * `client.expenses.*` — append-only cost-side event log + aggregated
 * cost summary. Records what eBay's Finances API doesn't know about
 * (acquisition, forwarder, external expenses); sales / refunds /
 * eBay fees come from `client.payouts.*` + `client.transactions.*`.
 */

import type { ExpenseRecordRequest, ExpenseRecordResponse, ExpenseSummaryResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ExpensesSummaryParams {
	/** Days back from now. Default 30. */
	windowDays?: number;
}

export interface ExpensesClient {
	record(req: ExpenseRecordRequest): Promise<ExpenseRecordResponse>;
	summary(params?: ExpensesSummaryParams): Promise<ExpenseSummaryResponse>;
}

export function createExpensesClient(http: FlipagentHttp): ExpensesClient {
	return {
		record: (req) => http.post("/v1/expenses/record", req),
		summary: (params) => http.get("/v1/expenses/summary", { windowDays: params?.windowDays }),
	};
}
