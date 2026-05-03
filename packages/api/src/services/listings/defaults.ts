/**
 * Auto-discovery for `POST /v1/listings` prerequisites — when the
 * caller omits `policies` or `merchantLocationKey`, we resolve them
 * from the seller's existing eBay account state. Cached 24h per
 * apiKey to avoid hitting `/sell/account/*_policy` on every create.
 *
 * **Auto-create on miss** — first-time sellers have zero policies on
 * their eBay account. Rather than throwing and forcing the user to
 * the eBay seller hub, we POST sane defaults (`flipagent default`
 * named) and return the new ids. The defaults are deliberately
 * conservative: 30-day buyer-paid returns, managed payments, USPS
 * Ground Advantage flat-rate domestic shipping, 1-day handling. Any
 * caller that wants different terms creates their own via
 * `/v1/policies` and passes explicit ids.
 *
 * Location is NOT auto-created — it needs a real address and is a
 * one-time set-up the seller has to do (via `/v1/locations`).
 */

import type { ListingPolicies } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";
import { createPolicy } from "../policies-write.js";

const TTL_MS = 24 * 60 * 60 * 1000;

interface CachedDefaults {
	policies?: Required<ListingPolicies>;
	merchantLocationKey?: string;
	expiresAt: number;
}

const cache = new Map<string, CachedDefaults>();

interface ResolvedDefaults {
	policies: Required<ListingPolicies>;
	merchantLocationKey: string;
}

export class DefaultsLookupError extends Error {
	readonly code: string;
	readonly status = 412;
	constructor(code: string, message: string) {
		super(message);
		this.name = "DefaultsLookupError";
		this.code = code;
	}
}

interface ReturnPolicyList {
	returnPolicies?: Array<{ returnPolicyId: string }>;
}
interface PaymentPolicyList {
	paymentPolicies?: Array<{ paymentPolicyId: string }>;
}
interface FulfillmentPolicyList {
	fulfillmentPolicies?: Array<{ fulfillmentPolicyId: string }>;
}
interface LocationList {
	locations?: Array<{ merchantLocationKey: string }>;
}

async function ensureReturnPolicy(apiKeyId: string, marketplace: string): Promise<string> {
	const list = await sellRequest<ReturnPolicyList>({
		apiKeyId,
		method: "GET",
		path: `/sell/account/v1/return_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
	});
	const existing = list?.returnPolicies?.[0]?.returnPolicyId;
	if (existing) return existing;
	const created = await createPolicy(
		{
			type: "return",
			name: "flipagent default — 30-day returns",
			marketplace: "ebay",
			categoryType: "ALL_EXCLUDING_MOTORS_VEHICLES",
			returnsAccepted: true,
			returnPeriodDays: 30,
			refundMethod: "MONEY_BACK",
			returnShippingCostPayer: "BUYER",
		},
		{ apiKeyId, marketplace },
	);
	return created.id;
}

async function ensurePaymentPolicy(apiKeyId: string, marketplace: string): Promise<string> {
	const list = await sellRequest<PaymentPolicyList>({
		apiKeyId,
		method: "GET",
		path: `/sell/account/v1/payment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
	});
	const existing = list?.paymentPolicies?.[0]?.paymentPolicyId;
	if (existing) return existing;
	const created = await createPolicy(
		{
			type: "payment",
			name: "flipagent default — managed payments",
			marketplace: "ebay",
			categoryType: "ALL_EXCLUDING_MOTORS_VEHICLES",
			immediatePay: false,
		},
		{ apiKeyId, marketplace },
	);
	return created.id;
}

async function ensureFulfillmentPolicy(apiKeyId: string, marketplace: string): Promise<string> {
	const list = await sellRequest<FulfillmentPolicyList>({
		apiKeyId,
		method: "GET",
		path: `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
	});
	const existing = list?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
	if (existing) return existing;
	// Free domestic shipping with USPS Ground Advantage. Buyers expect flat
	// or free shipping on most resale categories; "free" lets the seller
	// price-in shipping instead of surfacing it as a line item.
	const created = await createPolicy(
		{
			type: "fulfillment",
			name: "flipagent default — USPS Ground (free)",
			marketplace: "ebay",
			categoryType: "ALL_EXCLUDING_MOTORS_VEHICLES",
			handlingTimeDays: 1,
			shippingOptions: [
				{
					optionType: "DOMESTIC",
					costType: "FLAT_RATE",
					shippingServices: [
						{
							shippingServiceCode: "USPSGroundAdvantage",
							freeShipping: true,
						},
					],
				},
			],
		},
		{ apiKeyId, marketplace },
	);
	return created.id;
}

async function fetchDefaults(apiKeyId: string, marketplace: string): Promise<ResolvedDefaults> {
	// Policies auto-create on miss; location does not (needs a real address).
	const [ret, pay, ful, locationRes] = await Promise.all([
		ensureReturnPolicy(apiKeyId, marketplace),
		ensurePaymentPolicy(apiKeyId, marketplace),
		ensureFulfillmentPolicy(apiKeyId, marketplace),
		sellRequest<LocationList>({
			apiKeyId,
			method: "GET",
			path: `/sell/inventory/v1/location`,
		}),
	]);

	const loc = locationRes?.locations?.[0]?.merchantLocationKey;
	if (!loc) {
		throw new DefaultsLookupError(
			"missing_listing_prereqs",
			"No merchant location on the eBay account. Create one at POST /v1/locations with the warehouse / forwarder address before listing.",
		);
	}
	return {
		policies: {
			returnPolicyId: ret,
			paymentPolicyId: pay,
			fulfillmentPolicyId: ful,
		},
		merchantLocationKey: loc,
	};
}

export async function resolveListingDefaults(apiKeyId: string, marketplace = "EBAY_US"): Promise<ResolvedDefaults> {
	const key = `${apiKeyId}:${marketplace}`;
	const cached = cache.get(key);
	if (cached && cached.expiresAt > Date.now() && cached.policies && cached.merchantLocationKey) {
		return { policies: cached.policies, merchantLocationKey: cached.merchantLocationKey };
	}
	const fresh = await fetchDefaults(apiKeyId, marketplace);
	cache.set(key, { ...fresh, expiresAt: Date.now() + TTL_MS });
	return fresh;
}

/** Test-only — clear the in-memory cache. */
export function clearDefaultsCache(): void {
	cache.clear();
}
