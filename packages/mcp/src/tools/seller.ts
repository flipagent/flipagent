/**
 * Seller-account tools — `/v1/me/seller/*`. Read-only views on the
 * connected seller's standing, KYC, subscription tier, payments
 * program enrollment, advertising eligibility, and per-country sales
 * tax. Use these to decide whether sell-side actions will actually
 * succeed before queuing them.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

const empty = Type.Object({});

// `flipagent_seller_eligibility` removed — wrapped /v1/me/seller/eligibility
// which in turn called a non-existent eBay endpoint
// (`/sell/account/v1/eligibility`). Use `flipagent_get_seller_advertising_eligibility`
// or `flipagent_list_programs` for the equivalent program-eligibility signal.

/* ----------------------- flipagent_seller_privilege ------------------------ */

export const sellerPrivilegeInput = empty;
export const sellerPrivilegeDescription =
	'Read the seller\'s listing privileges — monthly listing limits, free-listing credits, category restrictions. Calls GET /v1/me/seller/privilege. **When to use** — answer "how many more listings can I post this month?" or diagnose why bulk uploads are getting throttled. **Inputs** — none. **Output** — `{ monthlyListingLimit, monthlyListingCount, monthlyListingValueLimit, monthlyListingValue, freeListingsRemaining, restrictedCategories?: string[] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.';
export async function sellerPrivilegeExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.privilege();
	} catch (err) {
		return toolErrorEnvelope(err, "seller_privilege_failed", "/v1/me/seller/privilege");
	}
}

/* -------------------------- flipagent_seller_kyc --------------------------- */

export const sellerKycInput = empty;
export const sellerKycDescription =
	'Read the seller\'s KYC (know-your-customer) verification status. Calls GET /v1/me/seller/kyc. **When to use** — diagnose blocked payouts or restricted selling. KYC failures stop money from moving even if listings publish fine. **Inputs** — none. **Output** — `{ status: "verified" | "pending" | "action_required" | "failed", missingDocuments?: string[], deadline? }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.';
export async function sellerKycExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.kyc();
	} catch (err) {
		return toolErrorEnvelope(err, "seller_kyc_failed", "/v1/me/seller/kyc");
	}
}

/* ----------------------- flipagent_seller_subscription --------------------- */

export const sellerSubscriptionInput = empty;
export const sellerSubscriptionDescription =
	'Read the seller\'s eBay Store subscription tier and benefits. Calls GET /v1/me/seller/subscription. **When to use** — gate features that need a Store tier (custom categories via `flipagent_upsert_store_categories`, certain promotion types, higher free-listing allowances). **Inputs** — none. **Output** — `{ tier: "none" | "starter" | "basic" | "premium" | "anchor" | "enterprise", renewsAt?, monthlyFee?, benefits?: {...} }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.';
export async function sellerSubscriptionExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.subscription();
	} catch (err) {
		return toolErrorEnvelope(err, "seller_subscription_failed", "/v1/me/seller/subscription");
	}
}

/* -------------------- flipagent_seller_payments_program -------------------- */

export const sellerPaymentsProgramInput = empty;
export const sellerPaymentsProgramDescription =
	"Read the seller's eBay Managed Payments enrollment status. Calls GET /v1/me/seller/payments-program. **When to use** — diagnose payouts not arriving (usually because Managed Payments setup is incomplete) or pre-flight before a high-volume listing push. **Inputs** — none. **Output** — `{ enrolled: boolean, status, bankAccount?: { last4 }, requiresAction?: string[] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function sellerPaymentsProgramExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.paymentsProgram();
	} catch (err) {
		return toolErrorEnvelope(err, "seller_payments_program_failed", "/v1/me/seller/payments-program");
	}
}

/* ----------------- flipagent_seller_advertising_eligibility ---------------- */

export const sellerAdvertisingEligibilityInput = empty;
export const sellerAdvertisingEligibilityDescription =
	'Check which Promoted Listings channels the seller is approved for. Calls GET /v1/me/seller/advertising-eligibility. **When to use** — gate before `flipagent_create_ad_campaign` — eBay restricts certain ad types until the seller meets standing thresholds. **Inputs** — none. **Output** — `{ channels: ["PRIORITY_LISTING" | "GENERAL" | "OFFSITE"], reasons?: { [channel]: string } }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.';
export async function sellerAdvertisingEligibilityExecute(
	config: Config,
	_args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.seller.advertisingEligibility();
	} catch (err) {
		return toolErrorEnvelope(err, "seller_advertising_eligibility_failed", "/v1/me/seller/advertising-eligibility");
	}
}

/* ----------------------- flipagent_seller_sales_tax ------------------------ */

export const sellerSalesTaxInput = Type.Object({
	country: Type.String({ minLength: 2, maxLength: 2, description: "ISO 3166-1 alpha-2 (e.g. US, GB)." }),
});
export const sellerSalesTaxDescription =
	'Read the seller\'s sales-tax / VAT setup for one country. Calls GET /v1/me/seller/sales-tax/{country}. **When to use** — diagnose missing tax collection on orders to a specific country, or audit which jurisdictions the seller is registered in. **Inputs** — `country` (ISO 3166-1 alpha-2, e.g. `US`, `GB`, `DE`). **Output** — `{ country, registered: boolean, vatNumber?, taxIdType?, applicableStates?: [...] }`. **Prereqs** — eBay seller account connected. **Example** — `{ country: "US" }`.';
export async function sellerSalesTaxExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const country = String(args.country);
	try {
		const client = getClient(config);
		return await client.seller.salesTax(country);
	} catch (err) {
		return toolErrorEnvelope(err, "seller_sales_tax_failed", `/v1/me/seller/sales-tax/${country}`);
	}
}
