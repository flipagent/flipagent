/**
 * Transactions — line-item granularity for the seller's eBay finances.
 * Sits next to `flipagent_payouts_list`: payouts are settled batches,
 * transactions are the per-event details (sale, refund, fee,
 * adjustment) that roll up into them.
 */

import { TransactionsListQuery } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { TransactionsListQuery as transactionsListInput };

export const transactionsListDescription =
	"List finance line items for the connected seller. GET /v1/transactions. Filter by `type` (sale|refund|fee|adjustment|reserve), `payoutId`, `from`/`to` ISO dates, `limit`, `offset`. cents-int Money. Use to reconcile a payout to its underlying events or to surface fees for `flipagent_expenses_record`.";

export async function transactionsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.transactions.list(args as Parameters<typeof client.transactions.list>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/transactions");
		return { error: "transactions_list_failed", status: e.status, url: e.url, message: e.message };
	}
}
