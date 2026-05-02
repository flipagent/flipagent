/**
 * `/v1/me/seller/*` — eBay sell/account ancillary endpoints that
 * aren't policies (privilege, KYC, subscriptions, sales-tax tables,
 * payments program, advertising eligibility).
 *
 * Each is read-mostly status data the seller needs for compliance,
 * onboarding, or rate-limit awareness. Lifted out of the lossy alias
 * passthroughs into typed shapes.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, ResponseSource } from "./_common.js";

export const SellerPrivilege = Type.Object(
	{
		sellerRegistrationCompleted: Type.Boolean(),
		sellingLimit: Type.Optional(
			Type.Object({
				amount: Type.Optional(Money),
				quantity: Type.Optional(Type.Integer({ minimum: 0 })),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerPrivilege" },
);
export type SellerPrivilege = Static<typeof SellerPrivilege>;

export const SellerKyc = Type.Object(
	{
		responses: Type.Array(
			Type.Object({
				field: Type.String(),
				status: Type.String({ description: "REQUIRED | APPROVED | REJECTED | EXPIRED | …" }),
				dueAt: Type.Optional(Type.String()),
				message: Type.Optional(Type.String()),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerKyc" },
);
export type SellerKyc = Static<typeof SellerKyc>;

export const SellerSubscription = Type.Object(
	{
		programs: Type.Array(
			Type.Object({
				programType: Type.String({
					description: "OUT_OF_STOCK_CONTROL | EBAY_PLUS | SELLING_POLICY_MANAGEMENT | …",
				}),
				status: Type.String({ description: "OPTED_IN | OPTED_OUT" }),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerSubscription" },
);
export type SellerSubscription = Static<typeof SellerSubscription>;

export const SellerPaymentsProgram = Type.Object(
	{
		marketplace: Marketplace,
		status: Type.String({ description: "OPTED_IN | OPTED_OUT | NOT_OPTED_IN" }),
		programType: Type.String({ description: "EBAY_PAYMENTS | …" }),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerPaymentsProgram" },
);
export type SellerPaymentsProgram = Static<typeof SellerPaymentsProgram>;

export const SellerAdvertisingEligibility = Type.Object(
	{
		marketplace: Marketplace,
		eligible: Type.Boolean(),
		programs: Type.Optional(
			Type.Array(Type.String({ description: "PROMOTED_LISTINGS_LITE | PROMOTED_LISTINGS_GENERAL | …" })),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerAdvertisingEligibility" },
);
export type SellerAdvertisingEligibility = Static<typeof SellerAdvertisingEligibility>;

export const SalesTaxRow = Type.Object(
	{
		country: Type.String(),
		jurisdictionId: Type.String(),
		salesTaxPercentage: Type.String(),
		shippingAndHandlingTaxed: Type.Boolean(),
		salesTaxJurisdictionName: Type.Optional(Type.String()),
	},
	{ $id: "SalesTaxRow" },
);
export type SalesTaxRow = Static<typeof SalesTaxRow>;

export const SalesTaxResponse = Type.Object(
	{ rows: Type.Array(SalesTaxRow), source: Type.Optional(ResponseSource) },
	{ $id: "SalesTaxResponse" },
);
export type SalesTaxResponse = Static<typeof SalesTaxResponse>;

/* --------- Rate tables (sell/account/v1/rate_table) ------------------ */

export const RateTable = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		marketplace: Marketplace,
		shippingOption: Type.Optional(Type.String({ description: "DOMESTIC | INTERNATIONAL" })),
		countryCode: Type.Optional(Type.String()),
	},
	{ $id: "RateTable" },
);
export type RateTable = Static<typeof RateTable>;

export const RateTablesListResponse = Type.Object(
	{ rateTables: Type.Array(RateTable), source: Type.Optional(ResponseSource) },
	{ $id: "RateTablesListResponse" },
);
export type RateTablesListResponse = Static<typeof RateTablesListResponse>;

/* --------- Custom policy (sell/account/v1/custom_policy) ------------- */

export const CustomPolicy = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		policyType: Type.String({ description: "PRODUCT_COMPLIANCE | TAKE_BACK" }),
		description: Type.Optional(Type.String()),
		label: Type.Optional(Type.String()),
		marketplace: Marketplace,
	},
	{ $id: "CustomPolicy" },
);
export type CustomPolicy = Static<typeof CustomPolicy>;

export const CustomPolicyCreate = Type.Object(
	{
		name: Type.String(),
		policyType: Type.String({ description: "PRODUCT_COMPLIANCE | TAKE_BACK" }),
		description: Type.Optional(Type.String()),
		label: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "CustomPolicyCreate" },
);
export type CustomPolicyCreate = Static<typeof CustomPolicyCreate>;

export const CustomPoliciesListResponse = Type.Object(
	{ customPolicies: Type.Array(CustomPolicy), source: Type.Optional(ResponseSource) },
	{ $id: "CustomPoliciesListResponse" },
);
export type CustomPoliciesListResponse = Static<typeof CustomPoliciesListResponse>;

/* ----- per-program eligibility (sell/account/eligibility) ------------ */

export const SellerEligibility = Type.Object(
	{
		marketplace: Marketplace,
		eligibilities: Type.Array(
			Type.Object({
				program: Type.String({ description: "EBAY_FOR_BUSINESS | INTERNATIONAL_SHIPPING | …" }),
				eligible: Type.Boolean(),
				reason: Type.Optional(Type.String()),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerEligibility" },
);
export type SellerEligibility = Static<typeof SellerEligibility>;
