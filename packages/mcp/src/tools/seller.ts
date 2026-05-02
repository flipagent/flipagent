/**
 * Seller-account tools — `/v1/me/seller/*`. Read-only views on the
 * connected seller's standing, KYC, subscription tier, payments
 * program enrollment, advertising eligibility, and per-country sales
 * tax. Use these to decide whether sell-side actions will actually
 * succeed before queuing them.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

const empty = Type.Object({});

/* ---------------------- flipagent_seller_eligibility ----------------------- */

export const sellerEligibilityInput = empty;
export const sellerEligibilityDescription =
	"Check whether the connected account is eligible to sell on eBay. GET /v1/me/seller/eligibility.";
export async function sellerEligibilityExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.eligibility();
	} catch (err) {
		const e = toApiCallError(err, "/v1/me/seller/eligibility");
		return { error: "seller_eligibility_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_seller_privilege ------------------------ */

export const sellerPrivilegeInput = empty;
export const sellerPrivilegeDescription =
	"Get the seller's listing privileges (monthly limits, fee credits). GET /v1/me/seller/privilege.";
export async function sellerPrivilegeExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.privilege();
	} catch (err) {
		const e = toApiCallError(err, "/v1/me/seller/privilege");
		return { error: "seller_privilege_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_seller_kyc --------------------------- */

export const sellerKycInput = empty;
export const sellerKycDescription =
	"Get the seller's KYC verification status. GET /v1/me/seller/kyc. Failures here block payouts.";
export async function sellerKycExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.kyc();
	} catch (err) {
		const e = toApiCallError(err, "/v1/me/seller/kyc");
		return { error: "seller_kyc_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_seller_subscription --------------------- */

export const sellerSubscriptionInput = empty;
export const sellerSubscriptionDescription =
	"Get the seller's eBay Store subscription tier (Basic|Premium|Anchor|Enterprise). GET /v1/me/seller/subscription.";
export async function sellerSubscriptionExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.subscription();
	} catch (err) {
		const e = toApiCallError(err, "/v1/me/seller/subscription");
		return { error: "seller_subscription_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------- flipagent_seller_payments_program -------------------- */

export const sellerPaymentsProgramInput = empty;
export const sellerPaymentsProgramDescription =
	"Get the seller's Managed Payments enrollment status. GET /v1/me/seller/payments-program.";
export async function sellerPaymentsProgramExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.paymentsProgram();
	} catch (err) {
		const e = toApiCallError(err, "/v1/me/seller/payments-program");
		return { error: "seller_payments_program_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------- flipagent_seller_advertising_eligibility ---------------- */

export const sellerAdvertisingEligibilityInput = empty;
export const sellerAdvertisingEligibilityDescription =
	"Check whether the seller can run Promoted Listings campaigns. GET /v1/me/seller/advertising-eligibility. Returns the list of channels (PRIORITY_LISTING, GENERAL, OFFSITE) the account is approved for.";
export async function sellerAdvertisingEligibilityExecute(
	config: Config,
	_args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.advertisingEligibility();
	} catch (err) {
		const e = toApiCallError(err, "/v1/me/seller/advertising-eligibility");
		return { error: "seller_advertising_eligibility_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_seller_sales_tax ------------------------ */

export const sellerSalesTaxInput = Type.Object({
	country: Type.String({ minLength: 2, maxLength: 2, description: "ISO 3166-1 alpha-2 (e.g. US, GB)." }),
});
export const sellerSalesTaxDescription =
	"Get the seller's sales-tax / VAT setup for one country. GET /v1/me/seller/sales-tax/{country}.";
export async function sellerSalesTaxExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const country = String(args.country);
	try {
		const client = getClient(config);
		return await client.seller.salesTax(country);
	} catch (err) {
		const e = toApiCallError(err, `/v1/me/seller/sales-tax/${country}`);
		return { error: "seller_sales_tax_failed", status: e.status, url: e.url, message: e.message };
	}
}
