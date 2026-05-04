/**
 * Transactions — line-item granularity for the seller's eBay finances.
 * Sits next to `flipagent_payouts_list`: payouts are settled batches,
 * transactions are the per-event details (sale, refund, fee,
 * adjustment) that roll up into them.
 */

import { TransactionsListQuery } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export { TransactionsListQuery as transactionsListInput };

export const transactionsListDescription =
	'List per-event finance line items for the connected seller — the granular layer behind payouts. Calls GET /v1/transactions. **When to use** — reconcile a payout (`{ payoutId }`) into its underlying sales / fees / refunds; surface final-value fees so they can be checked against your own books; build a P&L statement combined with `flipagent_get_expense_summary`. **Inputs** — optional `type` (`sale | refund | fee | adjustment | reserve`), optional `payoutId`, optional `orderId`, optional `from`/`to` ISO dates, pagination `limit` (default 50) + `offset`. **Output** — `{ transactions: Transaction[], limit, offset }` with cents-int `amountCents`. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action` with the connect URL. **Example** — `{ payoutId: "PAY-1234" }` to break down one payout.';

export async function transactionsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.transactions.list(args as Parameters<typeof client.transactions.list>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "transactions_list_failed", "/v1/transactions");
	}
}
