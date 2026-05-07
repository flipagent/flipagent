/**
 * Buy-side tools backed by `/v1/purchases`:
 *   flipagent_create_purchase   POST   /v1/purchases
 *   flipagent_list_purchases    GET    /v1/purchases
 *   flipagent_get_purchase      GET    /v1/purchases/{id}
 *   flipagent_cancel_purchase   POST   /v1/purchases/{id}/cancel
 *
 * Two outcomes:
 *   - terminal status (`completed`/`failed`) → render the receipt; stop
 *   - non-terminal status with `nextAction.url` → direct the user to
 *     that URL on the marketplace UI; poll `flipagent_get_purchase`
 *     until terminal
 *
 * Async polling: each `flipagent_get_purchase` call runs the
 * Trading-API reconciler inline (~300-700 ms), so the very next read
 * after the user clicks Confirm and pay flips `processing` →
 * `completed` — no need to wait for any background tick. Tracking
 * rows the user never confirms expire after 30 min. Same pattern as
 * `bids.ts` (BidList diff for auctions).
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------ flipagent_create_purchase ------------------------ */

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
	'Buy an item (one-shot Buy-It-Now). Calls POST /v1/purchases. **When to use** — direct purchase of a fixed-price listing or an auction\'s BIN ceiling; for auctions use `flipagent_place_bid` instead. **Inputs** — `itemId` (legacy 12-digit / `v1|n|v` / full ebay.com/itm URL), optional `quantity` (default 1), optional `variationId` (multi-variant listings). **Output** — `Purchase { id, marketplace, status, items, createdAt, marketplaceOrderId?, receiptUrl?, nextAction? }` plus `poll_with: "flipagent_get_purchase"` + `terminal_states`. **Outcomes** — terminal status on the response (the order is fully placed; render the receipt) **or** non-terminal status with `nextAction.url` (direct the user to that URL to click Buy It Now → Confirm and pay on the marketplace UI, then poll). The response shape is identical regardless of how the order is being driven internally. **Polling cadence** — 2-5 s between `flipagent_get_purchase` calls (each runs the Trading-API reconciler inline; the next read after the user confirms flips status to `completed`); stop on terminal (`completed | failed | cancelled`). Tracking rows the user never confirms expire after 30 min. **Example** — `{ itemId: "206252358068" }`.';

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
	{
		id: Type.String({
			format: "uuid",
			description: "Purchase id (the `id` field returned by `flipagent_create_purchase`).",
		}),
	},
	{ $id: "EbayOrderStatusInput" },
);

export const ebayOrderStatusDescription =
	'Read status + result for one purchase. Calls GET /v1/purchases/{id}. **When to use** — poll after `flipagent_create_purchase` until `status` is terminal (`completed | failed | cancelled`); also useful to re-check an old order\'s `marketplaceOrderId` / `receiptUrl`. **Inputs** — `id` (the UUID returned as `id` from `flipagent_create_purchase`). **Output** — `Purchase { id, marketplace, status, items, createdAt, marketplaceOrderId?, receiptUrl?, nextAction? }` or 404 if no such purchase under your api key. **Polling cadence** — 2-5 s while in flight. Each call runs the Trading-API reconciler inline (~300-700 ms): once eBay confirms the order, the very next read flips status to `completed`. Non-terminal rows whose user walked away from the marketplace tab carry `nextAction.url` again so the agent can re-prompt. **Example** — `{ id: "db7bd2d5-1dc4-4596-a7a1-ec9ca28a47d1" }`.';

export async function ebayOrderStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.purchases.get(id);
	} catch (err) {
		return toolErrorEnvelope(err, "get_purchase_failed", `/v1/purchases/${id}`);
	}
}

/* ------------------------- flipagent_list_purchases ------------------------ */

export const purchasesListInput = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		status: Type.Optional(
			Type.Union([
				Type.Literal("queued"),
				Type.Literal("processing"),
				Type.Literal("completed"),
				Type.Literal("failed"),
				Type.Literal("cancelled"),
			]),
		),
		marketplace: Type.Optional(Type.String()),
	},
	{ $id: "PurchasesListInput" },
);

export const purchasesListDescription =
	'List purchases the api key has placed. Calls GET /v1/purchases. **When to use** — review past + in-flight orders, filter by status (e.g. find all `processing` orders to nudge the user). Pair with `flipagent_get_purchase` for one-row detail. **Inputs** — optional `limit` (1-200, default 50), `offset` (default 0), `status` (`queued | processing | completed | failed | cancelled`), `marketplace` (`ebay_us`, …). **Output** — `{ purchases: Purchase[], total, limit, offset, source }`. **Prereqs** — none beyond the api key. **Example** — `{ status: "processing" }` to find orders awaiting the user\'s confirmation click.';

export async function purchasesListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const params = {
			...(args.limit != null ? { limit: args.limit as number } : {}),
			...(args.offset != null ? { offset: args.offset as number } : {}),
			...(args.status != null ? { status: args.status as string } : {}),
			...(args.marketplace != null ? { marketplace: args.marketplace as string } : {}),
		};
		return await client.purchases.list(
			(Object.keys(params).length ? params : undefined) as Parameters<typeof client.purchases.list>[0],
		);
	} catch (err) {
		return toolErrorEnvelope(err, "list_purchases_failed", "/v1/purchases");
	}
}

/* ------------------------ flipagent_purchases_cancel ------------------------ */

export const ebayOrderCancelInput = Type.Object(
	{
		id: Type.String({
			format: "uuid",
			description: "Purchase id (the `id` field returned by `flipagent_create_purchase`).",
		}),
	},
	{ $id: "EbayOrderCancelInput" },
);

export const ebayOrderCancelDescription =
	"Cancel a non-terminal purchase. Calls POST /v1/purchases/{id}/cancel. **When to use** — abort an order that's still `queued` / `awaiting_user_confirm` (extension hasn't opened the Confirm-and-pay page yet). Once the user is mid-place (status `placing`, on Confirm-and-pay) the cancel is a no-op — let the human's click decide. After `completed`, eBay Buy Order REST does not expose a public cancel; refund flow is `flipagent_create_cancellation`. **Inputs** — `id` (UUID from `flipagent_create_purchase`). **Output** — `Purchase` row, status now `cancelled` (or unchanged terminal if too late). **Prereqs** — none beyond the api key. **Example** — `{ id: \"db7bd2d5-1dc4-4596-a7a1-ec9ca28a47d1\" }`.";

export async function ebayOrderCancelExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.purchases.cancel(id);
	} catch (err) {
		return toolErrorEnvelope(err, "cancel_purchase_failed", `/v1/purchases/${id}/cancel`);
	}
}
