/**
 * `/v1/orders/*` schemas — bridge-driven buying flow.
 *
 * The hosted API queues a purchase order; the flipagent Chrome extension
 * (paired with the user's API key) claims it via `/v1/bridge/poll`, drives
 * the buy flow inside the user's real eBay session, and reports the outcome
 * via `/v1/bridge/result`. The user-facing surface is fully async — callers
 * POST a checkout, get a `purchaseOrderId`, and either poll
 * `GET /v1/orders/{id}` or subscribe to a webhook.
 *
 * `awaiting_user_confirm` is the v1 default — the extension stops at
 * "Confirm and pay" and waits for the user to OK in-browser or via
 * `POST /v1/orders/{id}/confirm`. No auto-confirm in v1.
 *
 * The same `purchase_order_id` shape lets us swap to eBay's official Order
 * API later (when `EBAY_ORDER_API_APPROVED=1`) without changing the public
 * surface — only the executor underneath changes.
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

/* ------------------------ POST /v1/orders/checkout ------------------------ */

export const CheckoutRequest = Type.Object(
	{
		source: Type.Optional(PurchaseOrderSource),
		itemId: Type.String({ minLength: 1, description: "eBay legacy item id (12-digit) or RESTful v1|...|0 form." }),
		quantity: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
		/** Walk away if the bridge client sees a listing price above this cap (incl. shipping). */
		maxPriceCents: Type.Optional(Type.Integer({ minimum: 0 })),
		/** Caller-supplied dedup key. Same key from same api key returns the same order. */
		idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 200 })),
		/** Free-form caller hints — passed through to the bridge client (e.g. shippingAddressId). */
		metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	},
	{ $id: "CheckoutRequest" },
);
export type CheckoutRequest = Static<typeof CheckoutRequest>;

export const CheckoutResponse = Type.Object(
	{
		purchaseOrderId: Type.String({ format: "uuid" }),
		status: PurchaseOrderStatus,
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "CheckoutResponse" },
);
export type CheckoutResponse = Static<typeof CheckoutResponse>;

/* ----------------------- GET /v1/orders/{id} ----------------------- */

export const PurchaseOrderResponse = PurchaseOrder;
export type PurchaseOrderResponse = PurchaseOrder;

/* ------------------ POST /v1/orders/{id}/{confirm,cancel} ------------------ */

export const PurchaseOrderActionResponse = PurchaseOrder;
export type PurchaseOrderActionResponse = PurchaseOrder;
