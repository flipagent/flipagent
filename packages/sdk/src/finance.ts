/**
 * `client.finance.*` — payouts + transaction history.
 */

import type { FlipagentHttp } from "./http.js";

export interface FinanceClient {
	listPayouts(query?: Record<string, string | number>): Promise<unknown>;
	listTransactions(query?: Record<string, string | number>): Promise<unknown>;
}

export function createFinanceClient(http: FlipagentHttp): FinanceClient {
	return {
		listPayouts: (query) => http.get("/v1/sell/finances/payout", query),
		listTransactions: (query) => http.get("/v1/sell/finances/transaction", query),
	};
}
