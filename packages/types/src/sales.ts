/**
 * `/v1/sales/*` — orders I've received as a seller. Compresses
 * eBay's sell/fulfillment + post-order surfaces relevant to the
 * "list orders → ship → refund" workflow.
 *
 *   GET    /v1/sales              list mine
 *   GET    /v1/sales/{id}         single sale
 *   POST   /v1/sales/{id}/ship    {tracking, carrier}
 *   POST   /v1/sales/{id}/refund  {amount, reason}
 *
 * `id` = eBay `orderId` (the `27-12345-67890` form).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Address, Marketplace, Money, Page } from "./_common.js";

export const SaleStatus = Type.Union(
	[
		Type.Literal("paid"),
		Type.Literal("shipped"),
		Type.Literal("delivered"),
		Type.Literal("refunded"),
		Type.Literal("cancelled"),
	],
	{ $id: "SaleStatus" },
);
export type SaleStatus = Static<typeof SaleStatus>;

export const SaleLineItem = Type.Object(
	{
		lineItemId: Type.String(),
		itemId: Type.String(),
		sku: Type.Optional(Type.String()),
		title: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
		price: Money,
		image: Type.Optional(Type.String()),
		variationId: Type.Optional(Type.String()),
	},
	{ $id: "SaleLineItem" },
);
export type SaleLineItem = Static<typeof SaleLineItem>;

export const SaleBuyer = Type.Object(
	{
		username: Type.String(),
		email: Type.Optional(Type.String()),
	},
	{ $id: "SaleBuyer" },
);
export type SaleBuyer = Static<typeof SaleBuyer>;

export const Sale = Type.Object(
	{
		id: Type.String({ description: "eBay orderId — '27-12345-67890' form." }),
		marketplace: Marketplace,
		status: SaleStatus,
		items: Type.Array(SaleLineItem),
		buyer: Type.Optional(SaleBuyer),
		shipTo: Type.Optional(Address),
		pricing: Type.Object({
			subtotal: Type.Optional(Money),
			shipping: Type.Optional(Money),
			tax: Type.Optional(Money),
			total: Money,
		}),
		shipping: Type.Optional(
			Type.Object({
				carrier: Type.Optional(Type.String()),
				trackingNumber: Type.Optional(Type.String()),
				shippedAt: Type.Optional(Type.String()),
				deliveredAt: Type.Optional(Type.String()),
			}),
		),
		paidAt: Type.String(),
		createdAt: Type.String(),
	},
	{ $id: "Sale" },
);
export type Sale = Static<typeof Sale>;

export const SaleShipRequest = Type.Object(
	{
		trackingNumber: Type.String(),
		carrier: Type.String({ description: "USPS | UPS | FEDEX | DHL | …" }),
		lineItemIds: Type.Optional(Type.Array(Type.String(), { description: "Defaults to all line items." })),
		shippedAt: Type.Optional(Type.String()),
	},
	{ $id: "SaleShipRequest" },
);
export type SaleShipRequest = Static<typeof SaleShipRequest>;

export const SaleRefundRequest = Type.Object(
	{
		amount: Type.Optional(Money),
		reason: Type.String({
			description: "BUYER_RETURN | NOT_AS_DESCRIBED | SHIPPING_LOST | OUT_OF_STOCK_OR_CANNOT_FULFILL | …",
		}),
		lineItemIds: Type.Optional(Type.Array(Type.String())),
		comment: Type.Optional(Type.String()),
	},
	{ $id: "SaleRefundRequest" },
);
export type SaleRefundRequest = Static<typeof SaleRefundRequest>;

export const SalesListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		status: Type.Optional(SaleStatus),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "SalesListQuery" },
);
export type SalesListQuery = Static<typeof SalesListQuery>;

export const SalesListResponse = Type.Composite(
	[
		Page,
		Type.Object({
			sales: Type.Array(Sale),
		}),
	],
	{ $id: "SalesListResponse" },
);
export type SalesListResponse = Static<typeof SalesListResponse>;

export const SaleResponse = Type.Composite([Sale], {
	$id: "SaleResponse",
});
export type SaleResponse = Static<typeof SaleResponse>;
