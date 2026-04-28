/**
 * Sell-side fulfillment: list incoming orders, mark each shipped. Requires
 * the api key to be connected to an eBay account (POST /v1/connect/ebay).
 */

import { ShippingFulfillmentDetails } from "@flipagent/types/ebay/sell";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayListOrdersInput = Type.Object({
	filter: Type.Optional(
		Type.String({ description: "eBay filter expression (e.g. orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS})" }),
	),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export const ebayListOrdersDescription =
	"List the connected seller's eBay orders. Calls GET /v1/fulfillment/order. Filter to find ones that need shipping.";

export async function ebayListOrdersExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const query: Record<string, string | number> = {};
		if (args.filter !== undefined) query.filter = args.filter as string;
		if (args.limit !== undefined) query.limit = args.limit as number;
		if (args.offset !== undefined) query.offset = args.offset as number;
		return await client.fulfillment.listOrders(query);
	} catch (err) {
		const e = toApiCallError(err, "/v1/fulfillment/order");
		return { error: "list_orders_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayMarkShippedInput = Type.Object({
	orderId: Type.String(),
	body: ShippingFulfillmentDetails,
});

export const ebayMarkShippedDescription =
	"Mark an eBay order as shipped (creates a shippingFulfillment). Calls POST /v1/fulfillment/order/{orderId}/shipping_fulfillment.";

export async function ebayMarkShippedExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.fulfillment.ship(args.orderId as string, args.body);
	} catch (err) {
		const e = toApiCallError(err, "/v1/fulfillment/order/{orderId}/shipping_fulfillment");
		return { error: "mark_shipped_failed", status: e.status, url: e.url, message: e.message };
	}
}
