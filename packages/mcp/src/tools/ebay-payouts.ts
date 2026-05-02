/**
 * Sell-side finance: payouts + per-transaction line items, used for
 * reconciliation. Requires connected eBay account.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayListPayoutsInput = Type.Object({
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 20 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export const ebayListPayoutsDescription =
	"List payouts for the connected seller. Calls GET /v1/payouts. cents-int Money + lifecycle status (initiated/succeeded/retryable_failed/terminal_failed/reversed).";

export async function ebayListPayoutsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.payouts.list({
			limit: args.limit as number | undefined,
			offset: args.offset as number | undefined,
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/payouts");
		return { error: "payouts_list_failed", status: e.status, url: e.url, message: e.message };
	}
}
