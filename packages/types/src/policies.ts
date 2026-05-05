/**
 * `/v1/policies` — selling policies (return / payment / fulfillment).
 * Wraps eBay's sell/account/{type}_policy as one unified resource;
 * each Policy carries a `type` discriminator. PUT/DELETE for a
 * single policy live at `/v1/policies/{type}/{id}`.
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

/**
 * Create body for any of the three business policies. Each `type`
 * uses a different field subset; the wrapper at
 * `services/policies-write.ts` translates this into the eBay-shape
 * body and POSTs to the right `/sell/account/v1/{type}_policy` path.
 *
 * Required across all three: `type`, `name`, `marketplace`. Each
 * policy type also has at least one shape-specific required field
 * (return needs `returnsAccepted`; fulfillment needs `handlingTimeDays`
 * + at least one `shippingOptions[]` entry; payment needs `immediatePay`).
 */
export const PolicyCreate = Type.Object(
	{
		type: PolicyType,
		name: Type.String(),
		marketplace: Type.Optional(Marketplace),
		description: Type.Optional(Type.String()),
		categoryType: Type.Optional(
			Type.Union([Type.Literal("ALL_EXCLUDING_MOTORS_VEHICLES"), Type.Literal("MOTORS_VEHICLES")]),
		),

		// return-only
		returnsAccepted: Type.Optional(Type.Boolean()),
		returnPeriodDays: Type.Optional(Type.Integer({ minimum: 0 })),
		refundMethod: Type.Optional(Type.Union([Type.Literal("MONEY_BACK"), Type.Literal("MERCHANDISE_CREDIT")])),
		returnShippingCostPayer: Type.Optional(Type.Union([Type.Literal("BUYER"), Type.Literal("SELLER")])),

		// payment-only
		immediatePay: Type.Optional(Type.Boolean()),

		// fulfillment-only
		handlingTimeDays: Type.Optional(Type.Integer({ minimum: 0 })),
		shippingOptions: Type.Optional(
			Type.Array(
				Type.Object({
					optionType: Type.Union([Type.Literal("DOMESTIC"), Type.Literal("INTERNATIONAL")]),
					costType: Type.Union([
						Type.Literal("FLAT_RATE"),
						Type.Literal("CALCULATED"),
						Type.Literal("NOT_SPECIFIED"),
					]),
					shippingServices: Type.Array(
						Type.Object({
							shippingServiceCode: Type.String(),
							shippingCost: Type.Optional(Money),
							additionalShippingCost: Type.Optional(Money),
							freeShipping: Type.Optional(Type.Boolean()),
						}),
					),
				}),
			),
		),
	},
	{ $id: "PolicyCreate" },
);
export type PolicyCreate = Static<typeof PolicyCreate>;

/**
 * `POST /v1/policies/setup` — atomic create-all of the seller policies
 * a listing needs. Replaces the old "auto-create with hidden flipagent
 * defaults" path: instead of guessing values that may cost the seller
 * money (free shipping default ate $10-15/listing), the agent gathers
 * the few decisions from the user via MCP and posts them once.
 *
 * Returns + fulfillment are user-supplied; payment is auto (eBay's
 * managed-payments program is uniform across all sellers since 2021,
 * so there's nothing to ask).
 *
 * Idempotent on existing policies — if the seller already has a
 * return/fulfillment policy, this re-uses the first one rather than
 * creating duplicates. The response always returns three ids ready
 * to pass to `POST /v1/listings`.
 */
export const PoliciesSetupRequest = Type.Object(
	{
		returns: Type.Object({
			accepted: Type.Boolean(),
			/** Required when `accepted: true`. eBay accepts 14, 30, 60. */
			periodDays: Type.Optional(Type.Union([Type.Literal(14), Type.Literal(30), Type.Literal(60)])),
			/** Required when `accepted: true`. */
			shippingPayer: Type.Optional(Type.Union([Type.Literal("buyer"), Type.Literal("seller")])),
		}),
		fulfillment: Type.Object({
			/** Business days from sale to shipment. eBay accepts 0-30. */
			handlingTimeDays: Type.Integer({ minimum: 0, maximum: 30 }),
			shipping: Type.Object({
				/** `free` = seller eats cost. `flat` = fixed amount. `calculated` = carrier rate at checkout (needs package weight on each listing). */
				mode: Type.Union([Type.Literal("free"), Type.Literal("flat"), Type.Literal("calculated")]),
				/** eBay shipping service code. Common: `USPSPriority`, `USPSGroundAdvantage`, `UPSGround`, `FedExGround`. */
				serviceCode: Type.String({ minLength: 2, maxLength: 60 }),
				/** Required when `mode: "flat"`. Cents-int. Charged to the buyer at checkout. */
				flatRateCents: Type.Optional(Type.Integer({ minimum: 0 })),
			}),
		}),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "PoliciesSetupRequest" },
);
export type PoliciesSetupRequest = Static<typeof PoliciesSetupRequest>;

export const PoliciesSetupResponse = Type.Object(
	{
		returnPolicyId: Type.String(),
		paymentPolicyId: Type.String(),
		fulfillmentPolicyId: Type.String(),
		/** Per-policy: `created` if we just made it, `existing` if we re-used an existing seller policy. */
		created: Type.Object({
			return: Type.Union([Type.Literal("created"), Type.Literal("existing")]),
			payment: Type.Union([Type.Literal("created"), Type.Literal("existing")]),
			fulfillment: Type.Union([Type.Literal("created"), Type.Literal("existing")]),
		}),
	},
	{ $id: "PoliciesSetupResponse" },
);
export type PoliciesSetupResponse = Static<typeof PoliciesSetupResponse>;
