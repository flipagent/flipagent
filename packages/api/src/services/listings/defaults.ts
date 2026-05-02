/**
 * Auto-discovery for `POST /v1/listings` prerequisites — when the
 * caller omits `policies` or `merchantLocationKey`, we resolve them
 * from the seller's existing eBay account state. Cached 24h per
 * apiKey to avoid hitting `/sell/account/*_policy` on every create.
 */

import type { ListingPolicies } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";

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

async function fetchDefaults(apiKeyId: string, marketplace: string): Promise<ResolvedDefaults> {
	const [returnRes, paymentRes, fulfillmentRes, locationRes] = await Promise.all([
		sellRequest<ReturnPolicyList>({
			apiKeyId,
			method: "GET",
			path: `/sell/account/v1/return_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
		}),
		sellRequest<PaymentPolicyList>({
			apiKeyId,
			method: "GET",
			path: `/sell/account/v1/payment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
		}),
		sellRequest<FulfillmentPolicyList>({
			apiKeyId,
			method: "GET",
			path: `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
		}),
		sellRequest<LocationList>({
			apiKeyId,
			method: "GET",
			path: `/sell/inventory/v1/location`,
		}),
	]);

	const ret = returnRes?.returnPolicies?.[0]?.returnPolicyId;
	const pay = paymentRes?.paymentPolicies?.[0]?.paymentPolicyId;
	const ful = fulfillmentRes?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
	const loc = locationRes?.locations?.[0]?.merchantLocationKey;

	const missing: string[] = [];
	if (!ret) missing.push("return_policy (use /v1/policies/return)");
	if (!pay) missing.push("payment_policy (use /v1/policies/payment)");
	if (!ful) missing.push("fulfillment_policy (use /v1/policies/fulfillment)");
	if (!loc) missing.push("merchant location (POST a location at /sell/inventory/v1/location/{key})");
	if (missing.length > 0) {
		throw new DefaultsLookupError(
			"missing_listing_prereqs",
			`Auto-discovery couldn't find: ${missing.join(", ")}. Create them in the eBay seller hub or pass explicit values.`,
		);
	}
	return {
		policies: {
			returnPolicyId: ret as string,
			paymentPolicyId: pay as string,
			fulfillmentPolicyId: ful as string,
		},
		merchantLocationKey: loc as string,
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
