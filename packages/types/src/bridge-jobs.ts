/**
 * Internal flipagent `BridgeJob` schema — the bridge queue's job
 * envelope, also serialized as the payload of outbound order-event
 * webhooks. NOT a public REST surface: the user-facing buy surface is
 * `/v1/buy/order/*` (eBay-shape `EbayPurchaseOrder`, REST + bridge
 * transports).
 *
 * The bridge-job queue (`services/bridge-jobs/queue.ts`) backs every
 * bridge-driven public surface — `/v1/buy/order/*` (when REST is
 * unapproved), `/v1/forwarder/{provider}/*`, `/v1/browser/*`. Each
 * source enqueues a `BridgeJob` row; the extension claims via
 * `/v1/bridge/poll` and reports via `/v1/bridge/result`.
 *
 * `awaiting_user_confirm` is the default for buy-side jobs — the
 * extension stops at "Confirm and pay" and waits for the user to OK
 * in-browser. No auto-confirm in v1.
 */

import { type Static, Type } from "@sinclair/typebox";

/* ------------------------------- shared ------------------------------- */

/**
 * Identifies which service this bridge job targets. The bridge client
 * dispatches to per-service content-script handlers based on this value.
 *
 *   ebay         — buy-side BIN/checkout flow (`/v1/buy/order/*`).
 *   planetexpress — package-forwarder ops (`/v1/forwarder/*`).
 *   control      — meta tasks against the extension itself
 *                  (e.g. `chrome.runtime.reload()`).
 *   browser      — synchronous DOM primitives (`/v1/browser/*`).
 *   ebay_data    — eBay public-data fetch through the user's logged-in
 *                  session (search / item-detail / sold). Same response
 *                  shape as Browse REST; bridge is just a transport.
 */
export const BridgeJobSource = Type.Union(
	[
		Type.Literal("ebay"),
		Type.Literal("planetexpress"),
		Type.Literal("control"),
		Type.Literal("browser"),
		Type.Literal("ebay_data"),
	],
	{ $id: "BridgeJobSource" },
);
export type BridgeJobSource = Static<typeof BridgeJobSource>;

export const BridgeJobStatus = Type.Union(
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
	{ $id: "BridgeJobStatus" },
);
export type BridgeJobStatus = Static<typeof BridgeJobStatus>;

export const BRIDGE_JOB_TERMINAL_STATUSES: ReadonlyArray<BridgeJobStatus> = [
	"completed",
	"failed",
	"cancelled",
	"expired",
];

export const BridgeJob = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		source: BridgeJobSource,
		itemId: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
		maxPriceCents: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		status: BridgeJobStatus,
		ebayOrderId: Type.Union([Type.String(), Type.Null()]),
		totalCents: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
		receiptUrl: Type.Union([Type.String(), Type.Null()]),
		failureReason: Type.Union([Type.String(), Type.Null()]),
		/**
		 * Task-specific payload reported by the bridge client. Buy-item
		 * jobs leave this null (receipt data lives on dedicated cols).
		 * Pull-packages jobs carry `{ packages: [...] }` here.
		 */
		result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "BridgeJob" },
);
export type BridgeJob = Static<typeof BridgeJob>;
