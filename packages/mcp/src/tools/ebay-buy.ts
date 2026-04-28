/**
 * `ebay_buy_item` / `ebay_order_status` / `ebay_order_cancel` — buy-side
 * tools backed by the flipagent Chrome extension (the "bridge client").
 *
 * `ebay_buy_item` queues an order and returns immediately with the
 * `purchase_order_id`. The agent should poll `ebay_order_status` until it
 * reports a terminal state — `completed`, `failed`, `cancelled`, `expired`.
 * That keeps the MCP tool bounded (no minute-long blocking calls) while
 * the user's extension handles the actual purchase asynchronously inside
 * their real Chrome session (so eBay's anti-bot layer treats it normally).
 *
 * Without the extension paired (no `fbt_…` bridge token issued), orders
 * sit `queued` forever and `expires_at` reaps them — the status tool
 * surfaces that cleanly. Install + setup at /docs/extension/.
 */

import { CheckoutRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------------- ebay_buy_item ----------------------------- */

export const ebayBuyItemInput = CheckoutRequest;

export const ebayBuyItemDescription =
	"Queue a buy-side order for the user's flipagent Chrome extension to execute. Calls POST /v1/orders/checkout. Returns immediately with `purchaseOrderId` and `status: queued`. Poll `ebay_order_status` until the status becomes terminal (`completed`, `failed`, `cancelled`, `expired`). The user must have installed the flipagent Chrome extension and paired it with their API key (one-time setup at https://flipagent.dev/docs/extension/) — without a paired extension the order will sit queued and expire.";

export async function ebayBuyItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.orders.checkout(args as Parameters<typeof client.orders.checkout>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/orders/checkout");
		return {
			error: "orders_checkout_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint:
				e.status === 401
					? "Set FLIPAGENT_API_KEY."
					: "Install the flipagent Chrome extension and pair it with this user's API key before queuing buys: https://flipagent.dev/docs/extension/",
		};
	}
}

/* --------------------------- ebay_order_status --------------------------- */

export const ebayOrderStatusInput = Type.Object(
	{ purchaseOrderId: Type.String({ format: "uuid" }) },
	{ $id: "EbayOrderStatusInput" },
);

export const ebayOrderStatusDescription =
	"Read current status + result for a queued purchase order. Calls GET /v1/orders/{id}. The `status` field tracks the extension's progress: queued → claimed → awaiting_user_confirm → placing → completed | failed. When `awaiting_user_confirm`, the extension is waiting for the user to OK the in-browser confirmation prompt.";

export async function ebayOrderStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.purchaseOrderId);
	try {
		const client = getClient(config);
		return await client.orders.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/orders/${id}`);
		return { error: "orders_get_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------------- ebay_order_cancel --------------------------- */

export const ebayOrderCancelInput = Type.Object(
	{ purchaseOrderId: Type.String({ format: "uuid" }) },
	{ $id: "EbayOrderCancelInput" },
);

export const ebayOrderCancelDescription =
	"Cancel a non-terminal purchase order. Calls POST /v1/orders/{id}/cancel. Cancels orders in queued / claimed / awaiting_user_confirm states; once the extension enters `placing` or the order is terminal, returns the unchanged current state. Returns the order's state after the cancel attempt.";

export async function ebayOrderCancelExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.purchaseOrderId);
	try {
		const client = getClient(config);
		return await client.orders.cancel(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/orders/${id}/cancel`);
		return { error: "orders_cancel_failed", status: e.status, url: e.url, message: e.message };
	}
}
