/**
 * Sell-side fulfillment: list orders received, mark each shipped.
 * Backed by `/v1/sales/*`.
 */

import { SaleShipRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayListOrdersInput = Type.Object({
	status: Type.Optional(Type.String({ description: "paid | shipped | delivered | refunded | cancelled" })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export const ebayListOrdersDescription =
	"List the connected seller's orders received. Calls GET /v1/sales. cents-int Money + 5-state lifecycle (paid/shipped/delivered/refunded/cancelled).";

export async function ebayListOrdersExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.sales.list({
			status: args.status as never,
			limit: args.limit as number | undefined,
			offset: args.offset as number | undefined,
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/sales");
		return { error: "sales_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayMarkShippedInput = Type.Composite([Type.Object({ orderId: Type.String() }), SaleShipRequest]);

export const ebayMarkShippedDescription = "Mark an order as shipped + tracking. Calls POST /v1/sales/{id}/ship.";

export async function ebayMarkShippedExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const { orderId, ...body } = args as Record<string, unknown>;
		return await client.sales.ship(String(orderId), body as unknown as Parameters<typeof client.sales.ship>[1]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/sales/{id}/ship");
		return { error: "sales_ship_failed", status: e.status, url: e.url, message: e.message };
	}
}
