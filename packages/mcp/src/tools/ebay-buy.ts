/**
 * `ebay_buy_item` / `ebay_order_status` / `ebay_order_cancel` — buy-side
 * tools backed by `/v1/purchases`. Auto-picks the REST transport when
 * `EBAY_ORDER_API_APPROVED=1`; otherwise drives the user's paired
 * Chrome extension (the "bridge client") to BIN inside their real
 * Chrome session.
 *
 * `ebay_buy_item` queues a purchase and returns immediately with the
 * `purchaseOrderId`. The agent should poll `ebay_order_status` until
 * it reports a terminal state — `completed`, `failed`, `cancelled`.
 * That keeps the MCP tool bounded (no minute-long blocking calls)
 * while the underlying transport works asynchronously.
 *
 * Without the extension paired (no `fbt_…` bridge token issued) and
 * REST not approved, purchases sit `queued` until they expire and
 * flip to `cancelled` — surface that cleanly. Install + setup at
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
	"Buy an item (one-shot). Calls POST /v1/purchases — flipagent's normalized buy surface, which compresses initiate + place_order into a single call. Returns a `Purchase` with status `queued`/`processing`/`completed`/`failed`/`cancelled`. Poll `ebay_order_status` until terminal. Auto-picks REST transport when `EBAY_ORDER_API_APPROVED=1`; otherwise the bridge transport drives the user's paired Chrome extension — install at https://flipagent.dev/docs/extension/.";

export async function ebayBuyItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const itemId = String(args.itemId);
		const quantity = (args.quantity as number | undefined) ?? 1;
		const variationId = args.variationId as string | undefined;
		return await client.purchases.create({
			items: [{ itemId, quantity, ...(variationId ? { variationId } : {}) }],
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/purchases");
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
	"Read status + result for a purchase order. Calls GET /v1/purchases/{id}. `status` lifecycle: queued → processing → completed | failed | cancelled.";

export async function ebayOrderStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.purchaseOrderId);
	try {
		const client = getClient(config);
		return await client.purchases.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/purchases/${id}`);
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
		return await client.purchases.cancel(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/purchases/${id}/cancel`);
		return { error: "buy_order_cancel_failed", status: e.status, url: e.url, message: e.message };
	}
}
