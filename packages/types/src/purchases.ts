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
 * Both transports — REST (with `EBAY_ORDER_APPROVED=1`) and bridge
 * (Chrome extension) — surface through this same shape. Multi-stage
 * shipping/payment/coupon overrides only work in REST transport;
 * passing them in bridge mode gets a 412 with a clear pointer.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Address, Marketplace, Money, Page, ResponseSource } from "./_common.js";

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

		/** "rest" or "bridge" — which transport actually placed the order. */
		transport: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("bridge")])),
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
		 * only — bridge transport uses the buyer's eBay-side default and
		 * 412s if this is set.
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
		transport: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("bridge")])),

		/**
		 * Per-order human-review attestation. eBay's User Agreement
		 * (effective Feb 20, 2026) prohibits "buy-for-me agents,
		 * LLM-driven bots, or any end-to-end flow that attempts to place
		 * orders without human review." flipagent's bridge transport
		 * requires this acknowledgement on every `/v1/purchases` call;
		 * REST transport requires it unless the eBay developer account
		 * holds Order API approval (`EBAY_ORDER_APPROVED=1`). Pass
		 * an ISO-8601 timestamp not older than 5 minutes — the
		 * attestation means a human in your interface confirmed THIS
		 * specific order within the last few minutes. The shape check
		 * (parseable + freshness window) lives in the orchestrator so
		 * stale + malformed return a uniform 412.
		 */
		humanReviewedAt: Type.Optional(Type.String({ description: "ISO-8601 timestamp" })),
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
