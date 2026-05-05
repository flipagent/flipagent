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
import { sellRequest, sellRequestWithLocation, swallowEbay404 } from "./ebay/rest/user-client.js";
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
		marketplace: "ebay_us",
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
		marketplace: "ebay_us",
		eligible: !!row?.eligibility,
		...(row?.programs ? { programs: row.programs } : {}),
	};
}

/**
 * Set or replace a sales-tax rate for one tax jurisdiction. Body shape
 * per OAS3 `SalesTaxBase`: `{ salesTaxPercentage, shippingAndHandlingTaxed }`.
 * `salesTaxPercentage` is a STRING (e.g. `"7.75"`) per eBay's wire format
 * — we accept a number on the flipagent surface and stringify here.
 */
export async function upsertSalesTax(
	country: string,
	jurisdictionId: string,
	input: { salesTaxPercentage: number; shippingAndHandlingTaxed?: boolean },
	ctx: SellerAccountContext,
): Promise<{ success: boolean }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/account/v1/sales_tax/${encodeURIComponent(country.toUpperCase())}/${encodeURIComponent(jurisdictionId)}`,
		body: {
			salesTaxPercentage: input.salesTaxPercentage.toString(),
			shippingAndHandlingTaxed: input.shippingAndHandlingTaxed ?? false,
		},
	});
	return { success: true };
}

/**
 * Replace many sales-tax rates in one call. Bulk variant of
 * `upsertSalesTax`; eBay caps at ~25 entries per call.
 */
export async function bulkUpsertSalesTax(
	entries: Array<{
		country: string;
		jurisdictionId: string;
		salesTaxPercentage: number;
		shippingAndHandlingTaxed?: boolean;
	}>,
	ctx: SellerAccountContext,
): Promise<{
	responses: Array<{ country: string; jurisdictionId: string; status: number; errors?: Array<{ message?: string }> }>;
}> {
	// Body shape per OAS3 `BulkSalesTaxInput`: top-level
	// `salesTaxInputList: [SalesTaxInput]` (NOT `requests`), and each
	// SalesTaxInput is FLAT (not wrapped in a `salesTax` sub-object) —
	// `{ countryCode, salesTaxJurisdictionId, salesTaxPercentage,
	//    shippingAndHandlingTaxed }`. Verified live 2026-05-03.
	const res = await sellRequest<{
		responses?: Array<{
			countryCode: string;
			salesTaxJurisdictionId: string;
			statusCode: number;
			errors?: Array<{ message?: string }>;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/account/v1/bulk_create_or_replace_sales_tax",
		body: {
			salesTaxInputList: entries.map((e) => ({
				countryCode: e.country.toUpperCase(),
				salesTaxJurisdictionId: e.jurisdictionId,
				salesTaxPercentage: e.salesTaxPercentage.toString(),
				shippingAndHandlingTaxed: e.shippingAndHandlingTaxed ?? false,
			})),
		},
	});
	return {
		responses: (res?.responses ?? []).map((r) => ({
			country: r.countryCode,
			jurisdictionId: r.salesTaxJurisdictionId,
			status: r.statusCode,
			...(r.errors ? { errors: r.errors } : {}),
		})),
	};
}

export async function deleteSalesTax(
	country: string,
	jurisdictionId: string,
	ctx: SellerAccountContext,
): Promise<{ success: boolean }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/account/v1/sales_tax/${encodeURIComponent(country.toUpperCase())}/${encodeURIComponent(jurisdictionId)}`,
	});
	return { success: true };
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
		marketplace: "ebay_us" as const,
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
		marketplace: "ebay_us" as const,
		...(p.description ? { description: p.description } : {}),
		...(p.label ? { label: p.label } : {}),
	}));
	return { customPolicies };
}

export async function createCustomPolicy(input: CustomPolicyCreate, ctx: SellerAccountContext): Promise<CustomPolicy> {
	// Returns 201 with empty body + `Location: http://api.ebay.com/sell/{id}`.
	// Verified live 2026-05-03 — extracting `customPolicyId` from body
	// always returned undefined.
	const { body, locationId } = await sellRequestWithLocation<{ customPolicyId?: string }>({
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
		id: body?.customPolicyId ?? locationId ?? "",
		name: input.name,
		policyType: input.policyType,
		marketplace: input.marketplace ?? "ebay_us",
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

/* --------- Sell Account v2: payout settings + rate-table read --------- */

/**
 * `GET /sell/account/v2/payout_settings` — payout schedule + percentage
 * + linked bank info. eBay's response shape is rich and rarely-used;
 * pass through verbatim under `raw`.
 */
export async function getPayoutSettings(ctx: SellerAccountContext): Promise<{ raw: unknown }> {
	const res = await sellRequest<unknown>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/account/v2/payout_settings",
	});
	return { raw: res };
}

/**
 * `POST /sell/account/v2/payout_settings/update_percentage` — change the
 * % of payout split between linked banks (multi-bank sellers).
 */
export async function updatePayoutPercentage(
	body: Record<string, unknown>,
	ctx: SellerAccountContext,
): Promise<{ raw: unknown }> {
	const res = await sellRequest<unknown>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/account/v2/payout_settings/update_percentage",
		body,
	});
	return { raw: res ?? null };
}

/**
 * `GET /sell/account/v2/rate_table/{id}` — full rate-table contents
 * (regions + costs). The v1 `listRateTables` only returns name + id.
 */
export async function getRateTableV2(id: string, ctx: SellerAccountContext): Promise<{ id: string; raw: unknown }> {
	const res = await sellRequest<unknown>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/account/v2/rate_table/${encodeURIComponent(id)}`,
	});
	return { id, raw: res };
}

/**
 * `POST /sell/account/v2/rate_table/{id}/update_shipping_cost` — patch
 * a region's shipping cost without rewriting the whole table.
 */
export async function updateRateTableShippingCost(
	id: string,
	body: Record<string, unknown>,
	ctx: SellerAccountContext,
): Promise<{ raw: unknown }> {
	const res = await sellRequest<unknown>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/account/v2/rate_table/${encodeURIComponent(id)}/update_shipping_cost`,
		body,
	});
	return { raw: res ?? null };
}
