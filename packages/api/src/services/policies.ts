/**
 * sell/account/{return,payment,fulfillment}_policy unification.
 * `/v1/policies` (all) and `/v1/policies/{type}` (one type).
 */

import type { Policy, PolicyType } from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";
import { toCents } from "./shared/money.js";

interface EbayReturnPolicy {
	returnPolicyId: string;
	name: string;
	description?: string;
	marketplaceId: string;
	returnsAccepted: boolean;
	returnPeriod?: { value: number; unit: string };
	refundMethod?: string;
	returnShippingCostPayer?: string;
}
interface EbayPaymentPolicy {
	paymentPolicyId: string;
	name: string;
	description?: string;
	marketplaceId: string;
	immediatePay?: boolean;
	paymentMethods?: Array<{ paymentMethodType: string }>;
}
interface EbayFulfillmentPolicy {
	fulfillmentPolicyId: string;
	name: string;
	description?: string;
	marketplaceId: string;
	handlingTime?: { value: number; unit: string };
	freightShipping?: boolean;
	shippingOptions?: Array<{
		shippingServices?: Array<{
			shippingServiceCode?: string;
			shippingCost?: { value: string; currency: string };
			additionalShippingCost?: { value: string; currency: string };
		}>;
	}>;
}

function returnPolicyToFlipagent(p: EbayReturnPolicy): Policy {
	return {
		id: p.returnPolicyId,
		type: "return",
		marketplace: "ebay",
		name: p.name,
		...(p.description ? { description: p.description } : {}),
		returnsAccepted: p.returnsAccepted,
		...(p.returnPeriod ? { returnPeriodDays: p.returnPeriod.value } : {}),
		...(p.refundMethod ? { refundMethod: p.refundMethod } : {}),
		...(p.returnShippingCostPayer === "BUYER" || p.returnShippingCostPayer === "SELLER"
			? { returnShippingCostPayer: p.returnShippingCostPayer.toLowerCase() as "buyer" | "seller" }
			: {}),
	};
}

function paymentPolicyToFlipagent(p: EbayPaymentPolicy): Policy {
	return {
		id: p.paymentPolicyId,
		type: "payment",
		marketplace: "ebay",
		name: p.name,
		...(p.description ? { description: p.description } : {}),
		...(p.immediatePay !== undefined ? { immediatePay: p.immediatePay } : {}),
		...(p.paymentMethods?.length ? { paymentMethods: p.paymentMethods.map((m) => m.paymentMethodType) } : {}),
	};
}

function fulfillmentPolicyToFlipagent(p: EbayFulfillmentPolicy): Policy {
	const shippingOptions: NonNullable<Policy["shippingOptions"]> = [];
	for (const o of p.shippingOptions ?? []) {
		for (const s of o.shippingServices ?? []) {
			if (!s.shippingServiceCode) continue;
			shippingOptions.push({
				service: s.shippingServiceCode,
				...(s.shippingCost
					? { cost: { value: toCents(s.shippingCost.value), currency: s.shippingCost.currency } }
					: {}),
				...(s.additionalShippingCost
					? {
							additional: {
								value: toCents(s.additionalShippingCost.value),
								currency: s.additionalShippingCost.currency,
							},
						}
					: {}),
			});
		}
	}
	return {
		id: p.fulfillmentPolicyId,
		type: "fulfillment",
		marketplace: "ebay",
		name: p.name,
		...(p.description ? { description: p.description } : {}),
		...(p.handlingTime ? { handlingTimeDays: p.handlingTime.value } : {}),
		...(p.freightShipping !== undefined ? { freightShipping: p.freightShipping } : {}),
		...(shippingOptions.length ? { shippingOptions } : {}),
	};
}

export interface PoliciesContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function listPolicies(
	type: PolicyType | undefined,
	ctx: PoliciesContext,
): Promise<{ policies: Policy[]; limit: number; offset: number }> {
	const marketplace = ctx.marketplace ?? "EBAY_US";
	const types: PolicyType[] = type ? [type] : ["return", "payment", "fulfillment"];
	const all: Policy[] = [];
	for (const t of types) {
		const path = `/sell/account/v1/${t}_policy?marketplace_id=${encodeURIComponent(marketplace)}`;
		if (t === "return") {
			const res = await sellRequest<{ returnPolicies?: EbayReturnPolicy[] }>({
				apiKeyId: ctx.apiKeyId,
				method: "GET",
				path,
			});
			all.push(...(res?.returnPolicies ?? []).map(returnPolicyToFlipagent));
		} else if (t === "payment") {
			const res = await sellRequest<{ paymentPolicies?: EbayPaymentPolicy[] }>({
				apiKeyId: ctx.apiKeyId,
				method: "GET",
				path,
			});
			all.push(...(res?.paymentPolicies ?? []).map(paymentPolicyToFlipagent));
		} else {
			const res = await sellRequest<{ fulfillmentPolicies?: EbayFulfillmentPolicy[] }>({
				apiKeyId: ctx.apiKeyId,
				method: "GET",
				path,
			});
			all.push(...(res?.fulfillmentPolicies ?? []).map(fulfillmentPolicyToFlipagent));
		}
	}
	return { policies: all, limit: all.length, offset: 0 };
}
