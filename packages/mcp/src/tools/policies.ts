/**
 * Selling-policy tools — return / payment / fulfillment policy ids.
 * `flipagent_listings_create` requires policy ids in the `policies`
 * field; agents should call `flipagent_policies_list` first to find
 * the seller's existing policy ids (or guide the user to create them
 * in the eBay seller hub if none exist — flipagent doesn't create
 * policies, it reads them).
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_policies_list ------------------------- */

export const policiesListInput = Type.Object({});

export const policiesListDescription =
	"List the connected seller's selling policies — return, payment, and fulfillment — in one call. Calls GET /v1/policies. **When to use** — required step before `flipagent_create_listing`: every listing needs three policy ids. **Inputs** — none. **Output** — `{ return: ReturnPolicy[], payment: PaymentPolicy[], fulfillment: FulfillmentPolicy[] }`. Take one `id` from each list (typically the seller's default) and pass them to `flipagent_create_listing` under `policies: { returnPolicyId, paymentPolicyId, fulfillmentPolicyId }`. **Prereqs** — eBay seller account connected, *plus* the seller must already have created policies in eBay's seller hub — flipagent reads policies but doesn't create them. If a list is empty, send the user to `seller.ebay.com/sh/policies` to create one. On 401 the response carries `next_action` with the connect URL. **Example** — call with `{}` and use `result.return[0].id` etc.";

export async function policiesListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.policies.list();
	} catch (err) {
		return toolErrorEnvelope(err, "policies_list_failed", "/v1/policies");
	}
}

/* ---------------------- flipagent_create_seller_policies -------------------- */

export const sellerPoliciesSetupInput = Type.Object({
	returns: Type.Object({
		accepted: Type.Boolean({ description: "Does the seller accept returns?" }),
		periodDays: Type.Optional(
			Type.Integer({
				description: "Required if accepted=true. eBay accepts 14, 30, or 60.",
				minimum: 14,
				maximum: 60,
			}),
		),
		shippingPayer: Type.Optional(
			Type.Union([Type.Literal("buyer"), Type.Literal("seller")], {
				description: "Required if accepted=true. Who pays for return shipping?",
			}),
		),
	}),
	fulfillment: Type.Object({
		handlingTimeDays: Type.Integer({
			minimum: 0,
			maximum: 30,
			description: "Business days between sale and shipment. Typical: 1-3.",
		}),
		shipping: Type.Object({
			mode: Type.Union([Type.Literal("free"), Type.Literal("flat"), Type.Literal("calculated")], {
				description:
					"free = seller eats cost. flat = fixed $X charged at checkout. calculated = carrier rate (needs package weight on each listing).",
			}),
			serviceCode: Type.String({
				minLength: 2,
				maxLength: 60,
				description:
					"eBay shipping service code. Safe defaults: USPSPriority. Common: USPSGroundAdvantage, UPSGround, FedExGround.",
			}),
			flatRateCents: Type.Optional(
				Type.Integer({ minimum: 0, description: "Required when mode=flat. Amount in cents." }),
			),
		}),
	}),
});

export const sellerPoliciesSetupDescription =
	"One-shot create-all of the three eBay seller policies a listing requires. Calls POST /v1/policies/setup. **When to use** — when `flipagent_create_listing` (or `flipagent_list_policies`) returned `missing_seller_policies` (412 with `next_action.kind: setup_seller_policies`). The agent should ASK the user 5 quick questions and pass the answers here, NOT invent silent defaults — earlier `flipagent_create_listing` invented free-shipping defaults that lost the seller real money on every listing. **Inputs** — `returns: { accepted, periodDays?, shippingPayer? }` (periodDays + shippingPayer required only when accepted=true) and `fulfillment: { handlingTimeDays, shipping: { mode, serviceCode, flatRateCents? } }`. Payment policy auto-creates (eBay's managed-payments program is uniform across sellers). **Output** — `{ returnPolicyId, paymentPolicyId, fulfillmentPolicyId, created: { return, payment, fulfillment: 'created' | 'existing' } }`. Idempotent — re-uses existing policies on the account when present. **Acceptable defaults to suggest** (always show explicitly): 30-day buyer-pays returns, 1-day handling, free USPSPriority. **Prereqs** — eBay seller account connected. **Example** — `{ returns: { accepted: true, periodDays: 30, shippingPayer: 'buyer' }, fulfillment: { handlingTimeDays: 1, shipping: { mode: 'free', serviceCode: 'USPSPriority' } } }`.";

export async function sellerPoliciesSetupExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.policies.setup(args as Parameters<typeof client.policies.setup>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "policies_setup_failed", "/v1/policies/setup");
	}
}
