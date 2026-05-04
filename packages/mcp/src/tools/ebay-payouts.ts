/**
 * Sell-side finance: payouts + per-transaction line items, used for
 * reconciliation. Requires connected eBay account.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const ebayListPayoutsInput = Type.Object({
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 20 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export const ebayListPayoutsDescription =
	'List eBay payouts (settlements to the seller\'s bank). Calls GET /v1/payouts. **When to use** — the headline cash-flow side of finance: "how much did I actually get paid in the last 30 days?". Pair with `flipagent_list_transactions` for per-event breakdown (sale, fee, refund) and `flipagent_get_expense_summary` for cost side. **Inputs** — pagination `limit` (1–200, default 20) + `offset`. **Output** — `{ payouts: Payout[], limit, offset }` with cents-int `amountCents`, currency, ISO `initiatedAt` / `paidOutAt`, lifecycle `status` in `initiated | succeeded | retryable_failed | terminal_failed | reversed`. **Prereqs** — eBay seller account connected (`/v1/connect/ebay`). On 401 the response carries `next_action` with the connect URL — quote it to the user. **Example** — `{ limit: 12 }` for the last ~12 payouts.';

export async function ebayListPayoutsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.payouts.list({
			limit: args.limit as number | undefined,
			offset: args.offset as number | undefined,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "payouts_list_failed", "/v1/payouts");
	}
}
