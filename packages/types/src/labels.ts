/**
 * `/v1/labels/*` — eBay-issued shipping labels (sell/logistics).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Address, Money } from "./_common.js";

export const LabelQuoteRequest = Type.Object(
	{
		shipFrom: Address,
		shipTo: Address,
		weight: Type.Object({
			value: Type.Number(),
			unit: Type.Union([
				Type.Literal("ounce"),
				Type.Literal("pound"),
				Type.Literal("gram"),
				Type.Literal("kilogram"),
			]),
		}),
		dimensions: Type.Optional(
			Type.Object({
				length: Type.Number(),
				width: Type.Number(),
				height: Type.Number(),
				unit: Type.Union([Type.Literal("inch"), Type.Literal("centimeter")]),
			}),
		),
	},
	{ $id: "LabelQuoteRequest" },
);
export type LabelQuoteRequest = Static<typeof LabelQuoteRequest>;

export const LabelOption = Type.Object(
	{
		quoteId: Type.String(),
		serviceCode: Type.String(),
		carrier: Type.String(),
		cost: Money,
		estimatedDeliveryFrom: Type.Optional(Type.String()),
		estimatedDeliveryTo: Type.Optional(Type.String()),
	},
	{ $id: "LabelOption" },
);
export type LabelOption = Static<typeof LabelOption>;

export const LabelQuoteResponse = Type.Object({ options: Type.Array(LabelOption) }, { $id: "LabelQuoteResponse" });
export type LabelQuoteResponse = Static<typeof LabelQuoteResponse>;

export const LabelPurchaseRequest = Type.Object(
	{ quoteId: Type.String(), orderId: Type.Optional(Type.String()) },
	{ $id: "LabelPurchaseRequest" },
);
export type LabelPurchaseRequest = Static<typeof LabelPurchaseRequest>;

export const Label = Type.Object(
	{
		id: Type.String(),
		serviceCode: Type.String(),
		carrier: Type.String(),
		trackingNumber: Type.Optional(Type.String()),
		labelUrl: Type.Optional(Type.String()),
		cost: Money,
		voidable: Type.Boolean(),
		purchasedAt: Type.String(),
	},
	{ $id: "Label" },
);
export type Label = Static<typeof Label>;
