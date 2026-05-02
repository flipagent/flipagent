/**
 * `client.payouts` + `client.transactions` — sell/finances reads, normalized.
 */

import type {
	PayoutsListQuery,
	PayoutsListResponse,
	TransactionsListQuery,
	TransactionsListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface PayoutsClient {
	list(params?: PayoutsListQuery): Promise<PayoutsListResponse>;
}
export interface TransactionsClient {
	list(params?: TransactionsListQuery): Promise<TransactionsListResponse>;
}

export function createPayoutsClient(http: FlipagentHttp): PayoutsClient {
	return {
		list: (params) => http.get("/v1/payouts", params as Record<string, string | number | undefined> | undefined),
	};
}

export function createTransactionsClient(http: FlipagentHttp): TransactionsClient {
	return {
		list: (params) => http.get("/v1/transactions", params as Record<string, string | number | undefined> | undefined),
	};
}
