/**
 * `ebay_buy_item` / `ebay_order_status` / `ebay_order_cancel` — buy-side
 * tools backed by the flipagent Chrome extension (the "bridge client")
 * via the `/v1/buy/order/*` surface (eBay Buy Order API mirror).
 *
 * `ebay_buy_item` queues an order and returns immediately with the
 * `purchaseOrderId`. The agent should poll `ebay_order_status` until it
 * reports a terminal state — `PROCESSED`, `FAILED`, `CANCELED`. That
 * keeps the MCP tool bounded (no minute-long blocking calls) while the
 * user's extension handles the actual purchase asynchronously inside
 * their real Chrome session.
 *
 * Without the extension paired (no `fbt_…` bridge token issued), orders
 * sit `QUEUED_FOR_PROCESSING` until they expire and `purchaseOrderStatus`
 * flips to `CANCELED` — surface that cleanly. Install + setup at
 * /docs/extension/.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------------- ebay_buy_item ----------------------------- */

export const ebayBuyItemInput = Type.Object(
	{
		itemId: Type.String({ minLength: 1, description: "eBay legacy item id (12-digit)." }),
		quantity: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
		variationId: Type.Optional(Type.String({ description: "eBay variation id when the listing has variants." })),
	},
	{ $id: "EbayBuyItemInput" },
);

export const ebayBuyItemDescription =
	"Queue a buy-side eBay order for the user's flipagent Chrome extension to execute. Calls POST /v1/buy/order/checkout_session/initiate then /place_order (single eBay-shape PurchaseOrder back). Returns immediately with `purchaseOrderId` and `purchaseOrderStatus: QUEUED_FOR_PROCESSING`. Poll `ebay_order_status` until terminal (`PROCESSED`, `FAILED`, `CANCELED`). The user must have installed the flipagent Chrome extension and paired it with their API key (one-time setup at https://flipagent.dev/docs/extension/) — without a paired extension the order will sit queued and expire.";

export async function ebayBuyItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.buy.order.quickCheckout(
			args as unknown as Parameters<typeof client.buy.order.quickCheckout>[0],
		);
	} catch (err) {
		const e = toApiCallError(err, "/v1/buy/order/checkout_session");
		return {
			error: "buy_order_failed",
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
	"Read current status + result for a queued purchase order. Calls GET /v1/buy/order/purchase_order/{id}. The `purchaseOrderStatus` field tracks the extension's progress: QUEUED_FOR_PROCESSING → PROCESSING → PROCESSED | FAILED | CANCELED. eBay shape — `lineItems`, `ebayOrderId`, `receiptUrl`, `failureReason` populated as the bridge progresses.";

export async function ebayOrderStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.purchaseOrderId);
	try {
		const client = getClient(config);
		return await client.buy.order.purchaseOrder.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/buy/order/purchase_order/${id}`);
		return { error: "buy_order_status_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------------- ebay_order_cancel --------------------------- */

export const ebayOrderCancelInput = Type.Object(
	{ purchaseOrderId: Type.String({ format: "uuid" }) },
	{ $id: "EbayOrderCancelInput" },
);

export const ebayOrderCancelDescription =
	"Cancel a non-terminal purchase order via the bridge protocol. Today this hits the underlying bridge queue cancel — orders in QUEUED_FOR_PROCESSING / PROCESSING (pre-place) flip to CANCELED; once the extension is mid-place the cancel is no-op. (eBay Buy Order REST does not expose a public cancel; this is the bridge-mode extension.)";

export async function ebayOrderCancelExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.purchaseOrderId);
	try {
		const client = getClient(config);
		// Bridge cancel — uses internal queue endpoint via http escape hatch
		// because eBay's Buy Order REST has no public cancel.
		return await client.http.post(`/v1/buy/order/purchase_order/${encodeURIComponent(id)}/cancel`, {});
	} catch (err) {
		const e = toApiCallError(err, `/v1/buy/order/purchase_order/${id}/cancel`);
		return { error: "buy_order_cancel_failed", status: e.status, url: e.url, message: e.message };
	}
}
