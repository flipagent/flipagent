/**
 * `/v1/disputes/*` — returns + cases + cancellations + inquiries +
 * payment-disputes unified into one resource with a `type`
 * discriminator. eBay splits these across post-order/v2 (4 resources)
 * + sell/fulfillment (payment_dispute); flipagent normalizes.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page, ResponseSource } from "./_common.js";

export const DisputeType = Type.Union(
	[
		Type.Literal("return"),
		Type.Literal("case"),
		Type.Literal("cancellation"),
		Type.Literal("inquiry"),
		Type.Literal("payment"),
	],
	{ $id: "DisputeType" },
);
export type DisputeType = Static<typeof DisputeType>;

export const DisputeStatus = Type.Union(
	[
		Type.Literal("open"),
		Type.Literal("seller_action_required"),
		Type.Literal("buyer_action_required"),
		Type.Literal("escalated"),
		Type.Literal("resolved"),
		Type.Literal("closed"),
	],
	{ $id: "DisputeStatus" },
);
export type DisputeStatus = Static<typeof DisputeStatus>;

export const Dispute = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		type: DisputeType,
		status: DisputeStatus,
		orderId: Type.String(),
		buyer: Type.Optional(Type.String()),
		reason: Type.Optional(Type.String()),
		amount: Type.Optional(Money),
		respondBy: Type.Optional(Type.String({ description: "ISO 8601 — seller respond deadline." })),
		createdAt: Type.String(),
		updatedAt: Type.Optional(Type.String()),
		closedAt: Type.Optional(Type.String()),
	},
	{ $id: "Dispute" },
);
export type Dispute = Static<typeof Dispute>;

export const DisputeRespond = Type.Object(
	{
		action: Type.Union([
			Type.Literal("accept"),
			Type.Literal("decline"),
			Type.Literal("counter"),
			Type.Literal("provide_tracking"),
			Type.Literal("offer_refund"),
			Type.Literal("escalate"),
		]),
		amount: Type.Optional(Money),
		trackingNumber: Type.Optional(Type.String()),
		carrier: Type.Optional(Type.String()),
		message: Type.Optional(Type.String({ maxLength: 1000 })),
	},
	{ $id: "DisputeRespond" },
);
export type DisputeRespond = Static<typeof DisputeRespond>;

export const DisputesListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		type: Type.Optional(DisputeType),
		status: Type.Optional(DisputeStatus),
		orderId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "DisputesListQuery" },
);
export type DisputesListQuery = Static<typeof DisputesListQuery>;

export const DisputesListResponse = Type.Composite(
	[Page, Type.Object({ disputes: Type.Array(Dispute), source: Type.Optional(ResponseSource) })],
	{ $id: "DisputesListResponse" },
);
export type DisputesListResponse = Static<typeof DisputesListResponse>;

export const DisputeResponse = Type.Composite([Dispute, Type.Object({ source: Type.Optional(ResponseSource) })], {
	$id: "DisputeResponse",
});
export type DisputeResponse = Static<typeof DisputeResponse>;
