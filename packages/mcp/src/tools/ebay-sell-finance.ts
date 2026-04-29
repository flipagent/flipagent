/**
 * Sell-side finance: payouts + per-transaction line items, used for
 * reconciliation. Requires connected eBay account.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayListPayoutsInput = Type.Object({
	filter: Type.Optional(Type.String({ description: "e.g. payoutDate:[2026-01-01..2026-12-31]" })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 20 })),
});

export const ebayListPayoutsDescription =
	"List eBay payouts for the connected seller. Calls GET /v1/sell/finances/payout. Each payout aggregates net seller proceeds across multiple orders.";

export async function ebayListPayoutsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const query: Record<string, string | number> = {};
		if (args.filter !== undefined) query.filter = args.filter as string;
		if (args.limit !== undefined) query.limit = args.limit as number;
		return await client.finance.listPayouts(query);
	} catch (err) {
		const e = toApiCallError(err, "/v1/sell/finances/payout");
		return { error: "list_payouts_failed", status: e.status, url: e.url, message: e.message };
	}
}
