/**
 * sell/account ops — privilege, KYC, subscription, payments program,
 * advertising eligibility, sales tax, rate tables, custom policies,
 * eligibility, fulfillment-policy ownership transfer. The
 * return/payment/fulfillment policy CRUD lives in services/policies/.
 */

import type {
	CustomPoliciesListResponse,
	CustomPolicy,
	CustomPolicyCreate,
	RateTable,
	RateTablesListResponse,
	SalesTaxResponse,
	SalesTaxRow,
	SellerAdvertisingEligibility,
	SellerKyc,
	SellerPaymentsProgram,
	SellerPrivilege,
	SellerSubscription,
} from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";
import { toCents } from "./shared/money.js";

interface EbayPrivilege {
	sellerRegistrationCompleted: boolean;
	sellingLimit?: { amount?: { value: string; currency: string }; quantity?: number };
}

export interface SellerAccountContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function getSellerPrivilege(ctx: SellerAccountContext): Promise<SellerPrivilege> {
	const res = await sellRequest<EbayPrivilege>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/account/v1/privilege",
	});
	const out: SellerPrivilege = { sellerRegistrationCompleted: !!res?.sellerRegistrationCompleted };
	if (res?.sellingLimit) {
		out.sellingLimit = {
			...(res.sellingLimit.amount
				? { amount: { value: toCents(res.sellingLimit.amount.value), currency: res.sellingLimit.amount.currency } }
				: {}),
			...(res.sellingLimit.quantity !== undefined ? { quantity: res.sellingLimit.quantity } : {}),
		};
	}
	return out;
}

export async function getSellerKyc(ctx: SellerAccountContext): Promise<SellerKyc> {
	const res = await sellRequest<{
		kycChecks?: Array<{ field: string; status: string; dueAt?: string; message?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/account/v1/kyc",
	}).catch(() => ({ kycChecks: [] }));
	return { responses: res?.kycChecks ?? [] };
}

export async function getSellerSubscription(ctx: SellerAccountContext): Promise<SellerSubscription> {
	const res = await sellRequest<{ subscriptions?: Array<{ programType: string; status: string }> }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/account/v1/subscription",
	}).catch(() => ({ subscriptions: [] }));
	return { programs: res?.subscriptions ?? [] };
}

export async function getSellerPaymentsProgram(ctx: SellerAccountContext): Promise<SellerPaymentsProgram> {
	const marketplace = ctx.marketplace ?? "EBAY_US";
	const res = await sellRequest<{ status: string; programType: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/account/v1/payments_program/${marketplace}/EBAY_PAYMENTS`,
	}).catch(swallowEbay404);
	return {
		marketplace: "ebay",
		status: res?.status ?? "NOT_OPTED_IN",
		programType: res?.programType ?? "EBAY_PAYMENTS",
	};
}

export async function getSellerAdvertisingEligibility(
	ctx: SellerAccountContext,
): Promise<SellerAdvertisingEligibility> {
	const marketplace = ctx.marketplace ?? "EBAY_US";
	// `X-EBAY-C-MARKETPLACE-ID` is REQUIRED on this endpoint per the
	// OpenAPI contract — omitting it returns errorId 35001 (eBay
	// internal error). Verified live 2026-05-02. Also `program_types`
	// (snake_case, plural) is the correct query param when filtering.
	const res = await sellRequest<{
		advertisingEligibility?: Array<{ marketplaceId: string; eligibility: boolean; programs?: string[] }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/account/v1/advertising_eligibility",
		marketplace,
	}).catch(swallowEbay404);
	const row = res?.advertisingEligibility?.find((r) => r.marketplaceId === marketplace);
	return {
		marketplace: "ebay",
		eligible: !!row?.eligibility,
		...(row?.programs ? { programs: row.programs } : {}),
	};
}

export async function getSalesTax(country: string, ctx: SellerAccountContext): Promise<SalesTaxResponse> {
	const res = await sellRequest<{
		salesTaxes?: Array<{
			country: string;
			salesTaxJurisdictionId: string;
			salesTaxPercentage: string;
			shippingAndHandlingTaxed: boolean;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/account/v1/sales_tax?country_code=${country.toUpperCase()}`,
	}).catch(swallowEbay404);
	const rows: SalesTaxRow[] = (res?.salesTaxes ?? []).map((r) => ({
		country: r.country,
		jurisdictionId: r.salesTaxJurisdictionId,
		salesTaxPercentage: r.salesTaxPercentage,
		shippingAndHandlingTaxed: r.shippingAndHandlingTaxed,
	}));
	return { rows };
}

export async function listRateTables(ctx: SellerAccountContext): Promise<RateTablesListResponse> {
	const res = await sellRequest<{
		rateTables?: Array<{
			rateTableId: string;
			name: string;
			marketplaceId: string;
			shippingOptionType?: string;
			countryCode?: string;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/account/v1/rate_table",
	}).catch(swallowEbay404);
	const rateTables: RateTable[] = (res?.rateTables ?? []).map((r) => ({
		id: r.rateTableId,
		name: r.name,
		marketplace: "ebay" as const,
		...(r.shippingOptionType ? { shippingOption: r.shippingOptionType } : {}),
		...(r.countryCode ? { countryCode: r.countryCode } : {}),
	}));
	return { rateTables };
}

interface EbayCustomPolicy {
	customPolicyId: string;
	name: string;
	policyType: string;
	description?: string;
	label?: string;
}

export async function listCustomPolicies(
	type: string | undefined,
	ctx: SellerAccountContext,
): Promise<CustomPoliciesListResponse> {
	const params = new URLSearchParams();
	if (type) params.set("policy_types", type.toUpperCase());
	const res = await sellRequest<{ customPolicies?: EbayCustomPolicy[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/account/v1/custom_policy?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	const customPolicies: CustomPolicy[] = (res?.customPolicies ?? []).map((p) => ({
		id: p.customPolicyId,
		name: p.name,
		policyType: p.policyType,
		marketplace: "ebay" as const,
		...(p.description ? { description: p.description } : {}),
		...(p.label ? { label: p.label } : {}),
	}));
	return { customPolicies };
}

export async function createCustomPolicy(input: CustomPolicyCreate, ctx: SellerAccountContext): Promise<CustomPolicy> {
	const res = await sellRequest<{ customPolicyId: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/account/v1/custom_policy",
		body: {
			name: input.name,
			policyType: input.policyType,
			...(input.description ? { description: input.description } : {}),
			...(input.label ? { label: input.label } : {}),
		},
		marketplace: ctx.marketplace,
	});
	return {
		id: res?.customPolicyId ?? "",
		name: input.name,
		policyType: input.policyType,
		marketplace: input.marketplace ?? "ebay",
		...(input.description ? { description: input.description } : {}),
		...(input.label ? { label: input.label } : {}),
	};
}

// `getSellerEligibility` removed — verified live 2026-05-02 that
// `/sell/account/v1/eligibility` returns 404 in every variant tried.
// The endpoint is not in eBay's published OpenAPI for the Account API
// either; it appears to never have existed. Caller surface
// (`/v1/seller/eligibility`) had been silently returning empty arrays
// since the wrapper was first written. Use
// `getSellerAdvertisingEligibility` (Promoted Listings + offsite ads
// eligibility) or `getOptedInPrograms` (programs the seller has
// joined) for the equivalent signal.

export async function transferFulfillmentPolicy(
	policyId: string,
	targetUsername: string,
	ctx: SellerAccountContext,
): Promise<{ success: boolean }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/account/v1/fulfillment_policy/${encodeURIComponent(policyId)}/transfer`,
		body: { targetSellerUsername: targetUsername },
		marketplace: ctx.marketplace,
	});
	return { success: true };
}
