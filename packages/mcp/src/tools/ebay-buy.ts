/**
 * `flipagent_purchases_create` / `_get` / `_cancel` — buy-side
 * tools backed by `/v1/purchases`. Auto-picks the REST transport when
 * `EBAY_ORDER_API_APPROVED=1`; otherwise drives the user's paired
 * Chrome extension (the "bridge client") to BIN inside their real
 * Chrome session.
 *
 * `flipagent_purchases_create` queues a purchase and returns immediately
 * with the `purchaseOrderId`. The agent should poll
 * `flipagent_purchases_get` until
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
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------ flipagent_purchases_create ------------------------ */

export const ebayBuyItemInput = Type.Object(
	{
		itemId: Type.String({
			minLength: 1,
			description:
				"eBay item identifier. Accepts the 12-digit legacy id, a `v1|<n>|<variationId>` form, or a full `https://www.ebay.com/itm/<n>?var=<v>` URL — the api normalizes them. Use the same id you fed to `flipagent_evaluate_item`.",
		}),
		quantity: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
		variationId: Type.Optional(Type.String({ description: "eBay variation id when the listing has variants." })),
	},
	{ $id: "EbayBuyItemInput" },
);

export const ebayBuyItemDescription =
	"Buy an item (one-shot). Calls POST /v1/purchases — flipagent's normalized buy surface, which compresses initiate + place_order into a single call. Returns a `Purchase` with `status` in `queued | processing | completed | failed | cancelled`; poll `flipagent_get_purchase` until terminal. Auto-picks REST transport when the api operator has set `EBAY_ORDER_API_APPROVED=1` and the api key has eBay OAuth bound; otherwise the bridge transport drives the user's paired Chrome extension. On failure the response carries `next_action` with the exact link to send the user to (extension install / OAuth start).";

const LEGACY_ITEM_ID = /^\d{9,15}$/;
const V1_ITEM_ID = /^v1\|(\d{9,15})\|(\d+)$/i;

/**
 * Accept evaluate-style itemIds (URLs, `v1|n|v`, raw legacy id) and
 * extract the 12-digit legacy form + variation. Keeps the input
 * grammar identical between `flipagent_evaluate_item` and
 * `flipagent_create_purchase` so an agent doesn't reshape data
 * mid-flow.
 */
function normalizeItemId(raw: string): { itemId: string; variationId: string | undefined } {
	const trimmed = raw.trim();
	if (LEGACY_ITEM_ID.test(trimmed)) return { itemId: trimmed, variationId: undefined };
	const v1 = V1_ITEM_ID.exec(trimmed);
	if (v1) return { itemId: v1[1]!, variationId: v1[2] !== "0" ? v1[2] : undefined };
	try {
		const u = new URL(trimmed);
		const m = /\/itm\/(?:[^/]+\/)?(\d{9,15})/.exec(u.pathname);
		if (m) {
			const variationId = u.searchParams.get("var") ?? undefined;
			return { itemId: m[1]!, variationId: variationId && variationId !== "0" ? variationId : undefined };
		}
	} catch {
		// not a URL; fall through
	}
	// Last-resort: pass through as-is and let the api reject it with a
	// helpful 400 so the user sees the validation message.
	return { itemId: trimmed, variationId: undefined };
}

export async function ebayBuyItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const { itemId, variationId: parsedVariation } = normalizeItemId(String(args.itemId));
		const quantity = (args.quantity as number | undefined) ?? 1;
		const variationId = (args.variationId as string | undefined) ?? parsedVariation;
		const result = await client.purchases.create({
			items: [{ itemId, quantity, ...(variationId ? { variationId } : {}) }],
		});
		// Pin the polling tool name into the response so the agent
		// doesn't have to remember the verb_noun convention. Mirrors
		// SEP-1686's `tasks/get` pattern for long-running ops.
		return {
			...(result as Record<string, unknown>),
			poll_with: "flipagent_get_purchase",
			terminal_states: ["completed", "failed", "cancelled"],
		};
	} catch (err) {
		return toolErrorEnvelope(err, "create_purchase_failed", "/v1/purchases");
	}
}

/* -------------------------- flipagent_purchases_get -------------------------- */

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
		return toolErrorEnvelope(err, "get_purchase_failed", `/v1/purchases/${id}`);
	}
}

/* ------------------------ flipagent_purchases_cancel ------------------------ */

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
		return toolErrorEnvelope(err, "cancel_purchase_failed", `/v1/purchases/${id}/cancel`);
	}
}
