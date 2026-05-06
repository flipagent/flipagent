/**
 * `/v1/purchases/*` — items I've bought. Buy-side write surface.
 *
 * Compresses eBay's two-stage Buy Order flow
 *   POST /buy/order/v1/checkout_session/initiate
 *   POST /buy/order/v1/checkout_session/{sessionId}/place_order
 * (plus the optional shipping/payment/coupon update endpoints) into a
 * single `POST /v1/purchases`. Caller passes the items + (optional)
 * overrides; we initiate, apply overrides if any, then place_order.
 *
 * Three transports surface through the same shape:
 *   - REST   (with `EBAY_ORDER_APPROVED=1`) — eBay's Buy Order API
 *            places the order server-side. Multi-stage shipping/
 *            payment/coupon overrides work here.
 *   - BRIDGE (paired Chrome extension) — extension opens the ebay.com/
 *            itm tab, shows a cap-validation banner, and captures the
 *            orderId off /vod/ for fast reconciliation.
 *   - URL    (no extension, no REST approval) — the API returns
 *            `nextAction.url` pointing at the ebay.com/itm page; the
 *            user clicks Buy It Now → Confirm and pay on eBay's own
 *            UI. Trading-API reconciler matches completion against a
 *            snapshot captured at queue time.
 *
 * Auto-pick order: REST (if approved) → BRIDGE (if paired) → URL.
 * Multi-stage shipping/payment/coupon overrides are REST-only; passing
 * them in bridge or url mode returns 412.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Address, Marketplace, Money, NextAction, Page, ResponseSource } from "./_common.js";

export const PurchaseStatus = Type.Union(
	[
		Type.Literal("queued"),
		Type.Literal("processing"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("cancelled"),
	],
	{ $id: "PurchaseStatus" },
);
export type PurchaseStatus = Static<typeof PurchaseStatus>;

export const PurchaseItem = Type.Object(
	{
		/** Marketplace item id (eBay legacy numeric, or platform-native). */
		itemId: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
		variationId: Type.Optional(Type.String()),

		/** Filled when the orchestrator enriches with a marketplace lookup at place time. */
		title: Type.Optional(Type.String()),
		price: Type.Optional(Money),
		image: Type.Optional(Type.String()),
	},
	{ $id: "PurchaseItem" },
);
export type PurchaseItem = Static<typeof PurchaseItem>;

export const PurchasePricing = Type.Object(
	{
		subtotal: Type.Optional(Money),
		shipping: Type.Optional(Money),
		tax: Type.Optional(Money),
		total: Type.Optional(Money),
	},
	{ $id: "PurchasePricing" },
);
export type PurchasePricing = Static<typeof PurchasePricing>;

export const Purchase = Type.Object(
	{
		/** eBay `purchaseOrderId`. The handle for status polls + cancel. */
		id: Type.String(),
		marketplace: Marketplace,
		status: PurchaseStatus,

		items: Type.Array(PurchaseItem),
		pricing: Type.Optional(PurchasePricing),

		/** Marketplace-side downstream order id once the buy clears (separate from `id`). */
		marketplaceOrderId: Type.Optional(Type.String()),
		receiptUrl: Type.Optional(Type.String()),
		failureReason: Type.Optional(Type.String()),

		createdAt: Type.String(),
		completedAt: Type.Optional(Type.String()),

		/**
		 * "rest" (server placed it), "bridge" (paired Chrome extension
		 * drives the click), or "url" (the user clicks through on
		 * ebay.com via the deeplink in `nextAction`).
		 */
		transport: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("bridge"), Type.Literal("url")])),

		/**
		 * Deeplink to drive the order forward when transport is "url".
		 * Agent/UI directs the user to `nextAction.url` (the ebay.com/itm
		 * page); the order completes once the user clicks through and
		 * the reconciler matches. Omitted in REST + bridge transports
		 * (the user doesn't need a URL — REST placed the order server-
		 * side, and bridge already opened the tab in the user's browser).
		 */
		nextAction: Type.Optional(NextAction),
	},
	{ $id: "Purchase" },
);
export type Purchase = Static<typeof Purchase>;

export const PurchasePaymentInstrument = Type.Object(
	{
		paymentMethodType: Type.String({ description: "CREDIT_CARD | WALLET | …" }),
		paymentMethodBrand: Type.Optional(Type.String({ description: "VISA | PAYPAL | APPLE_PAY | …" })),
		token: Type.Optional(Type.String()),
	},
	{ $id: "PurchasePaymentInstrument" },
);
export type PurchasePaymentInstrument = Static<typeof PurchasePaymentInstrument>;

export const PurchaseCreate = Type.Object(
	{
		/** One or more items to buy in this order. eBay caps at 10 per session. */
		items: Type.Array(
			Type.Object({
				itemId: Type.String(),
				quantity: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
				variationId: Type.Optional(Type.String()),
			}),
			{ minItems: 1, maxItems: 10 },
		),

		marketplace: Type.Optional(Marketplace),

		/**
		 * Override the buyer's default shipping address. REST transport
		 * only — bridge + url transports use the buyer's eBay-side
		 * default and 412 if this is set.
		 */
		shipTo: Type.Optional(Address),

		/** Coupon / promo code. REST-only, same caveat as `shipTo`. */
		couponCode: Type.Optional(Type.String()),

		/** Override the buyer's default payment method (REST-only). */
		paymentInstruments: Type.Optional(Type.Array(PurchasePaymentInstrument)),

		/** Pre-validate against this expected pricing — REST returns 412 when totals drift. */
		expectedPricing: Type.Optional(
			Type.Object({
				subtotal: Type.Optional(Money),
				shipping: Type.Optional(Money),
				tax: Type.Optional(Money),
				total: Type.Optional(Money),
			}),
		),

		/** Whether to use the guest checkout path (no eBay account required). REST-only. */
		guest: Type.Optional(Type.Boolean()),

		/** Force a specific transport. Auto-picks when omitted. */
		transport: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("bridge"), Type.Literal("url")])),
	},
	{ $id: "PurchaseCreate" },
);
export type PurchaseCreate = Static<typeof PurchaseCreate>;

/* ----- Multi-stage update endpoints (REST-only) ----------------------- */

export const PurchaseShipToUpdate = Type.Object({ shipTo: Address }, { $id: "PurchaseShipToUpdate" });
export type PurchaseShipToUpdate = Static<typeof PurchaseShipToUpdate>;

export const PurchasePaymentUpdate = Type.Object(
	{ paymentInstruments: Type.Array(PurchasePaymentInstrument) },
	{ $id: "PurchasePaymentUpdate" },
);
export type PurchasePaymentUpdate = Static<typeof PurchasePaymentUpdate>;

export const PurchaseCouponUpdate = Type.Object({ couponCode: Type.String() }, { $id: "PurchaseCouponUpdate" });
export type PurchaseCouponUpdate = Static<typeof PurchaseCouponUpdate>;

export const PurchasesListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		status: Type.Optional(PurchaseStatus),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "PurchasesListQuery" },
);
export type PurchasesListQuery = Static<typeof PurchasesListQuery>;

export const PurchasesListResponse = Type.Composite(
	[
		Page,
		Type.Object({
			purchases: Type.Array(Purchase),
			source: Type.Optional(ResponseSource),
		}),
	],
	{ $id: "PurchasesListResponse" },
);
export type PurchasesListResponse = Static<typeof PurchasesListResponse>;

export const PurchaseResponse = Type.Composite([Purchase, Type.Object({ source: Type.Optional(ResponseSource) })], {
	$id: "PurchaseResponse",
});
export type PurchaseResponse = Static<typeof PurchaseResponse>;
