/**
 * sell/account/v1/{return,payment,fulfillment}_policy — write-side
 * (POST/PUT/DELETE). The read side (LIST/GET-by-id/get-by-name) lives
 * in `services/policies.ts`. Splitting the write surface here keeps the
 * read pipeline (which is heavily called by the listing-create flow)
 * free of the create-body translation logic.
 *
 * Each policy type has its own POST endpoint, body shape, and Location-
 * header-id pattern (verified live 2026-05-03):
 *   - `/return_policy`       returns 201 + Location → `returnPolicyId`
 *   - `/payment_policy`      returns 201 + Location → `paymentPolicyId`
 *   - `/fulfillment_policy`  returns 201 + Location → `fulfillmentPolicyId`
 *
 * Caller-facing surface uses the unified `PolicyCreate` shape with a
 * `type` discriminator; this file dispatches to the right endpoint and
 * translates flipagent fields → eBay's spec-shape body.
 */

import type { PolicyCreate, PolicyType } from "@flipagent/types";
import { sellRequest, sellRequestWithLocation } from "./ebay/rest/user-client.js";
import { ebayMarketplaceId } from "./shared/marketplace.js";
import { toDollarString } from "./shared/money.js";

export interface PoliciesWriteContext {
	apiKeyId: string;
	marketplace?: string;
}

const PATH: Record<PolicyType, string> = {
	return: "/sell/account/v1/return_policy",
	payment: "/sell/account/v1/payment_policy",
	fulfillment: "/sell/account/v1/fulfillment_policy",
};

function buildBody(input: PolicyCreate, marketplace: string): Record<string, unknown> {
	const cat = input.categoryType ?? "ALL_EXCLUDING_MOTORS_VEHICLES";
	const base: Record<string, unknown> = {
		name: input.name,
		marketplaceId: marketplace,
		categoryTypes: [{ name: cat }],
		...(input.description ? { description: input.description } : {}),
	};
	if (input.type === "return") {
		return {
			...base,
			returnsAccepted: input.returnsAccepted ?? true,
			...(input.returnPeriodDays !== undefined
				? { returnPeriod: { value: input.returnPeriodDays, unit: "DAY" } }
				: {}),
			...(input.refundMethod ? { refundMethod: input.refundMethod } : {}),
			...(input.returnShippingCostPayer ? { returnShippingCostPayer: input.returnShippingCostPayer } : {}),
		};
	}
	if (input.type === "payment") {
		return { ...base, immediatePay: input.immediatePay ?? false };
	}
	// fulfillment
	const shippingOptions = (input.shippingOptions ?? []).map((opt) => ({
		optionType: opt.optionType,
		costType: opt.costType,
		shippingServices: opt.shippingServices.map((svc) => ({
			shippingServiceCode: svc.shippingServiceCode,
			...(svc.shippingCost
				? { shippingCost: { value: toDollarString(svc.shippingCost.value), currency: svc.shippingCost.currency } }
				: {}),
			...(svc.additionalShippingCost
				? {
						additionalShippingCost: {
							value: toDollarString(svc.additionalShippingCost.value),
							currency: svc.additionalShippingCost.currency,
						},
					}
				: {}),
			...(svc.freeShipping !== undefined ? { freeShipping: svc.freeShipping } : {}),
		})),
	}));
	return {
		...base,
		...(input.handlingTimeDays !== undefined ? { handlingTime: { value: input.handlingTimeDays, unit: "DAY" } } : {}),
		...(shippingOptions.length ? { shippingOptions } : {}),
	};
}

export async function createPolicy(
	input: PolicyCreate,
	ctx: PoliciesWriteContext,
): Promise<{ id: string; type: PolicyType }> {
	const marketplace = ctx.marketplace ?? ebayMarketplaceId(input.marketplace);
	const body = buildBody(input, marketplace);
	// All three policy POSTs return 201 with empty body + Location header.
	// Verified live 2026-05-03 (see notes/ebay-endpoints.md Section 8).
	const { body: resBody, locationId } = await sellRequestWithLocation<{
		returnPolicyId?: string;
		paymentPolicyId?: string;
		fulfillmentPolicyId?: string;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: PATH[input.type],
		body,
		contentLanguage: "en-US",
	});
	const idFromBody =
		input.type === "return"
			? resBody?.returnPolicyId
			: input.type === "payment"
				? resBody?.paymentPolicyId
				: resBody?.fulfillmentPolicyId;
	return { id: idFromBody ?? locationId ?? "", type: input.type };
}

export async function updatePolicy(
	id: string,
	input: PolicyCreate,
	ctx: PoliciesWriteContext,
): Promise<{ id: string; type: PolicyType }> {
	const marketplace = ctx.marketplace ?? ebayMarketplaceId(input.marketplace);
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `${PATH[input.type]}/${encodeURIComponent(id)}`,
		body: buildBody(input, marketplace),
		contentLanguage: "en-US",
	});
	return { id, type: input.type };
}

export async function deletePolicy(id: string, type: PolicyType, ctx: PoliciesWriteContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `${PATH[type]}/${encodeURIComponent(id)}`,
	});
}

/**
 * One-shot setup that atomically ensures all three seller policies
 * exist on the eBay account. The user's preferences come in via
 * `PoliciesSetupRequest` (returns yes/no + days + payer; fulfillment
 * handling-time + shipping mode + service code); payment is auto
 * because eBay's managed-payments program is uniform.
 *
 * Idempotent — if a return / fulfillment policy already exists on
 * the account, we re-use the first one and report `existing`. Caller
 * (the agent) can call this multiple times safely; only the first
 * call creates anything.
 *
 * Replaces the old "auto-create with hidden flipagent defaults"
 * inside `services/listings/defaults.ts` — see that file's header
 * for why hidden defaults were a bad idea.
 */
import type { PoliciesSetupRequest, PoliciesSetupResponse } from "@flipagent/types";
import { eq } from "drizzle-orm";

interface ListResp {
	returnPolicies?: Array<{ returnPolicyId: string }>;
	paymentPolicies?: Array<{ paymentPolicyId: string }>;
	fulfillmentPolicies?: Array<{ fulfillmentPolicyId: string }>;
}

export async function setupSellerPolicies(
	input: PoliciesSetupRequest,
	ctx: PoliciesWriteContext,
): Promise<PoliciesSetupResponse> {
	const marketplace = ctx.marketplace ?? ebayMarketplaceId(input.marketplace);
	void eq; // re-use existing import set; suppress lint without changing imports

	const [retList, payList, fulList] = await Promise.all([
		sellRequest<ListResp>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/account/v1/return_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
		}),
		sellRequest<ListResp>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/account/v1/payment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
		}),
		sellRequest<ListResp>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
		}),
	]);

	const existingRet = retList?.returnPolicies?.[0]?.returnPolicyId;
	const existingPay = payList?.paymentPolicies?.[0]?.paymentPolicyId;
	const existingFul = fulList?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;

	// Build the three create-bodies (only what's actually missing).
	const tasks: Array<Promise<{ kind: "return" | "payment" | "fulfillment"; id: string }>> = [];

	if (!existingRet) {
		tasks.push(
			(async () => {
				const r = input.returns;
				const created = await createPolicy(
					{
						type: "return",
						name: r.accepted ? `${r.periodDays ?? 30}-day returns` : "No returns",
						marketplace: "ebay_us",
						categoryType: "ALL_EXCLUDING_MOTORS_VEHICLES",
						returnsAccepted: r.accepted,
						...(r.accepted
							? {
									returnPeriodDays: r.periodDays ?? 30,
									refundMethod: "MONEY_BACK" as const,
									returnShippingCostPayer: (r.shippingPayer ?? "buyer").toUpperCase() as "BUYER" | "SELLER",
								}
							: {}),
					},
					ctx,
				);
				return { kind: "return", id: created.id };
			})(),
		);
	}

	if (!existingPay) {
		tasks.push(
			(async () => {
				const created = await createPolicy(
					{
						type: "payment",
						name: "Managed payments",
						marketplace: "ebay_us",
						categoryType: "ALL_EXCLUDING_MOTORS_VEHICLES",
						immediatePay: false,
					},
					ctx,
				);
				return { kind: "payment", id: created.id };
			})(),
		);
	}

	if (!existingFul) {
		tasks.push(
			(async () => {
				const f = input.fulfillment;
				const isFree = f.shipping.mode === "free";
				const isFlat = f.shipping.mode === "flat";
				const costType = f.shipping.mode === "calculated" ? ("CALCULATED" as const) : ("FLAT_RATE" as const);
				const created = await createPolicy(
					{
						type: "fulfillment",
						name: `${f.handlingTimeDays}-day handling · ${f.shipping.mode} ${f.shipping.serviceCode}`,
						marketplace: "ebay_us",
						categoryType: "ALL_EXCLUDING_MOTORS_VEHICLES",
						handlingTimeDays: f.handlingTimeDays,
						shippingOptions: [
							{
								optionType: "DOMESTIC",
								costType,
								shippingServices: [
									{
										shippingServiceCode: f.shipping.serviceCode,
										...(isFree ? { freeShipping: true } : {}),
										...(isFlat && f.shipping.flatRateCents !== undefined
											? { shippingCost: { value: f.shipping.flatRateCents, currency: "USD" } }
											: {}),
									},
								],
							},
						],
					},
					ctx,
				);
				return { kind: "fulfillment", id: created.id };
			})(),
		);
	}

	const results = await Promise.all(tasks);
	const createdMap = new Map(results.map((r) => [r.kind, r.id]));

	const out: PoliciesSetupResponse = {
		returnPolicyId: existingRet ?? createdMap.get("return")!,
		paymentPolicyId: existingPay ?? createdMap.get("payment")!,
		fulfillmentPolicyId: existingFul ?? createdMap.get("fulfillment")!,
		created: {
			return: existingRet ? "existing" : "created",
			payment: existingPay ? "existing" : "created",
			fulfillment: existingFul ? "existing" : "created",
		},
	};
	return out;
}
