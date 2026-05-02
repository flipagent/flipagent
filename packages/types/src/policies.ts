/**
 * `/v1/policies/{type}` — selling policies (return / payment /
 * fulfillment). Wraps eBay's sell/account/{type}_policy with one
 * resource and a `type` discriminator.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page, ResponseSource } from "./_common.js";

export const PolicyType = Type.Union([Type.Literal("return"), Type.Literal("payment"), Type.Literal("fulfillment")], {
	$id: "PolicyType",
});
export type PolicyType = Static<typeof PolicyType>;

/**
 * Generic policy. Each `type` populates a different sub-set of fields:
 *   return       → returnsAccepted, returnPeriodDays, refundMethod, returnShippingCostPayer
 *   payment      → paymentMethods, immediatePay
 *   fulfillment  → handlingTimeDays, shippingOptions, freightShipping
 */
export const Policy = Type.Object(
	{
		id: Type.String(),
		type: PolicyType,
		marketplace: Marketplace,
		name: Type.String(),
		description: Type.Optional(Type.String()),
		default: Type.Optional(Type.Boolean()),

		// return-only
		returnsAccepted: Type.Optional(Type.Boolean()),
		returnPeriodDays: Type.Optional(Type.Integer({ minimum: 0 })),
		refundMethod: Type.Optional(Type.String()),
		returnShippingCostPayer: Type.Optional(Type.Union([Type.Literal("buyer"), Type.Literal("seller")])),

		// payment-only
		paymentMethods: Type.Optional(Type.Array(Type.String())),
		immediatePay: Type.Optional(Type.Boolean()),

		// fulfillment-only
		handlingTimeDays: Type.Optional(Type.Integer({ minimum: 0 })),
		shippingOptions: Type.Optional(
			Type.Array(
				Type.Object({
					service: Type.String(),
					cost: Type.Optional(Money),
					additional: Type.Optional(Money),
				}),
			),
		),
		freightShipping: Type.Optional(Type.Boolean()),
	},
	{ $id: "Policy" },
);
export type Policy = Static<typeof Policy>;

export const PoliciesListResponse = Type.Composite(
	[Page, Type.Object({ policies: Type.Array(Policy), source: Type.Optional(ResponseSource) })],
	{ $id: "PoliciesListResponse" },
);
export type PoliciesListResponse = Static<typeof PoliciesListResponse>;

export const PolicyResponse = Type.Composite([Policy, Type.Object({ source: Type.Optional(ResponseSource) })], {
	$id: "PolicyResponse",
});
export type PolicyResponse = Static<typeof PolicyResponse>;

/* ----- ownership transfer (sell/account/fulfillment_policy/transfer) - */

export const PolicyTransferRequest = Type.Object({ targetUsername: Type.String() }, { $id: "PolicyTransferRequest" });
export type PolicyTransferRequest = Static<typeof PolicyTransferRequest>;
