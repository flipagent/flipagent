/**
 * Internal flipagent `PurchaseOrder` schema — the bridge queue's job
 * envelope, also serialized as the payload of outbound order-event
 * webhooks. NOT a public REST surface: the user-facing buy surface is
 * `/v1/buy/order/*` (eBay-shape `EbayPurchaseOrder`, REST + bridge
 * transports).
 *
 * The bridge queue (`services/orders/queue.ts`) backs every
 * bridge-driven public surface — `/v1/buy/order/*` (when REST is
 * unapproved), `/v1/forwarder/{provider}/*`, `/v1/browser/*`. Each
 * source enqueues a `PurchaseOrder` row; the extension claims via
 * `/v1/bridge/poll` and reports via `/v1/bridge/result`.
 *
 * `awaiting_user_confirm` is the default for buy-side jobs — the
 * extension stops at "Confirm and pay" and waits for the user to OK
 * in-browser. No auto-confirm in v1.
 */

import { type Static, Type } from "@sinclair/typebox";

/* ------------------------------- shared ------------------------------- */

/**
 * Identifies which service this purchase-order targets. Today eBay (real
 * buy flow) and `planetexpress` (forwarder inbox read, scaffolded). Same
 * `purchase_order_id` envelope serves both — the bridge client dispatches
 * to per-service content-script handlers based on `args.marketplace`
 * inside the BridgeJob.
 */
export const PurchaseOrderSource = Type.Union(
	[Type.Literal("ebay"), Type.Literal("planetexpress"), Type.Literal("control"), Type.Literal("browser")],
	{ $id: "PurchaseOrderSource" },
);
export type PurchaseOrderSource = Static<typeof PurchaseOrderSource>;

export const PurchaseOrderStatus = Type.Union(
	[
		Type.Literal("queued"),
		Type.Literal("claimed"),
		Type.Literal("awaiting_user_confirm"),
		Type.Literal("placing"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("cancelled"),
		Type.Literal("expired"),
	],
	{ $id: "PurchaseOrderStatus" },
);
export type PurchaseOrderStatus = Static<typeof PurchaseOrderStatus>;

export const PURCHASE_ORDER_TERMINAL_STATUSES: ReadonlyArray<PurchaseOrderStatus> = [
	"completed",
	"failed",
	"cancelled",
	"expired",
];

export const PurchaseOrder = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		source: PurchaseOrderSource,
		itemId: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
		maxPriceCents: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		status: PurchaseOrderStatus,
		ebayOrderId: Type.Union([Type.String(), Type.Null()]),
		totalCents: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		receiptUrl: Type.Union([Type.String(), Type.Null()]),
		failureReason: Type.Union([Type.String(), Type.Null()]),
		/**
		 * Task-specific payload reported by the bridge client. Buy-item
		 * orders leave this null (receipt data lives on dedicated cols).
		 * Pull-packages orders carry `{ packages: [...] }` here.
		 */
		result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "PurchaseOrder" },
);
export type PurchaseOrder = Static<typeof PurchaseOrder>;
