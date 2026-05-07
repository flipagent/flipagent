/**
 * `/v1/purchases/*` — items I've bought. Buy-side write surface.
 *
 * Compresses eBay's two-stage Buy Order flow (initiate + place_order)
 * into a single `POST /v1/purchases`. The contract from a caller's
 * perspective is two outcomes:
 *
 *   - terminal status (`completed` / `failed`) on the response →
 *     order is fully placed; the agent shows the receipt and stops
 *   - non-terminal status (`queued` / `processing`) with `nextAction`
 *     → user action is needed; the agent directs the user to
 *     `nextAction.url` and polls `GET /v1/purchases/{id}` until
 *     the status flips
 *
 * Whether the API places the order server-side, hands it off to a
 * paired Chrome extension, or returns a deeplink for the user to
 * complete on ebay.com is an internal implementation detail — the
 * caller doesn't see any of that, and the response shape is
 * identical across the three modes.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Address, Marketplace, Money, NextAction, Page } from "./_common.js";

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
		 * Set when the order needs the user to do something on the
		 * marketplace UI (typically: open the listing and click Buy It
		 * Now). Absent when the order was placed server-side or has
		 * already reached a terminal status.
		 */
		nextAction: Type.Optional(NextAction),
	},
	{ $id: "Purchase" },
);
export type Purchase = Static<typeof Purchase>;

export const PurchasePaymentInstrument = Type.Object(
	{
		paymentMethodType: Type.String(),
		paymentMethodBrand: Type.Optional(Type.String()),
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

		// --- Advanced fields (only honored when the server is configured for
		// direct order placement; the API returns 412 with a clean error
		// otherwise). Kept in the schema so the contract stays stable across
		// server states — agents that don't pass them get the deeplink flow
		// transparently.

		shipTo: Type.Optional(Address),
		couponCode: Type.Optional(Type.String()),
		paymentInstruments: Type.Optional(Type.Array(PurchasePaymentInstrument)),
		expectedPricing: Type.Optional(
			Type.Object({
				subtotal: Type.Optional(Money),
				shipping: Type.Optional(Money),
				tax: Type.Optional(Money),
				total: Type.Optional(Money),
			}),
		),
		guest: Type.Optional(Type.Boolean()),
	},
	{ $id: "PurchaseCreate" },
);
export type PurchaseCreate = Static<typeof PurchaseCreate>;

/* ----- Multi-stage update endpoints ----------------------------------- */
/* Honored only when the server is configured for direct order placement. */

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

export const PurchasesListResponse = Type.Composite([Page, Type.Object({ purchases: Type.Array(Purchase) })], {
	$id: "PurchasesListResponse",
});
export type PurchasesListResponse = Static<typeof PurchasesListResponse>;

export const PurchaseResponse = Purchase;
export type PurchaseResponse = Static<typeof PurchaseResponse>;
