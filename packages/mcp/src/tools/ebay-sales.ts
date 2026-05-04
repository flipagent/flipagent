/**
 * Sell-side fulfillment: list orders received, mark each shipped.
 * Backed by `/v1/sales/*`.
 */

import { SaleShipRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const ebayListOrdersInput = Type.Object({
	status: Type.Optional(Type.String({ description: "paid | shipped | delivered | refunded | cancelled" })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export const ebayListOrdersDescription =
	'List orders the connected seller has received (sales the agent now needs to fulfill). Calls GET /v1/sales. **When to use** — daily fulfillment loop: pull `status=paid` to get orders waiting for shipment, hand each to `flipagent_ship_sale`. Pair with `flipagent_get_forwarder_job` if items live at a forwarder. **Inputs** — optional `status` (`paid | shipped | delivered | refunded | cancelled`), pagination `limit` (1–200, default 50) + `offset`. **Output** — `{ sales: Sale[], limit, offset }`. Each `Sale` carries cents-int Money + the 5-state lifecycle + buyer + line items. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action` with the connect URL. **Example** — `{ status: "paid" }` to find orders ready to ship.';

export async function ebayListOrdersExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.sales.list({
			status: args.status as never,
			limit: args.limit as number | undefined,
			offset: args.offset as number | undefined,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "sales_list_failed", "/v1/sales");
	}
}

export const ebayMarkShippedInput = Type.Composite([Type.Object({ orderId: Type.String() }), SaleShipRequest]);

export const ebayMarkShippedDescription =
	'Mark a sale as shipped with tracking. Calls POST /v1/sales/{id}/ship. **When to use** — once the package is in the carrier\'s hands (or scheduled for pickup); flips the sale\'s status from `paid` to `shipped` and notifies the buyer through eBay. **Inputs** — `orderId` (the sale id from `flipagent_list_sales`), `trackingNumber`, `carrier` (e.g. `USPS`, `UPS`, `FedEx`, `DHL`), optional `shippedAt` ISO timestamp (defaults to now), optional `lineItems` array to ship partial. **Output** — confirmation `{ orderId, status: "shipped", trackingNumber, carrier }`. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action` with the connect URL. **Example** — `{ orderId: "1234567890", trackingNumber: "94001ABCDEF", carrier: "USPS" }`.';

export async function ebayMarkShippedExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const { orderId, ...body } = args as Record<string, unknown>;
		return await client.sales.ship(String(orderId), body as unknown as Parameters<typeof client.sales.ship>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "sales_ship_failed", "/v1/sales/{id}/ship");
	}
}
