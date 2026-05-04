/**
 * Auto-discovery for `POST /v1/listings` prerequisites — when the
 * caller omits `policies` or `merchantLocationKey`, we resolve them
 * from the seller's existing eBay account state. Cached 24h per
 * apiKey to avoid hitting `/sell/account/*_policy` on every create.
 *
 * **No more hidden auto-create with flipagent defaults.** Earlier
 * versions invented sane-looking defaults (free shipping, 30-day
 * buyer-pays returns, 1-day handling) on the seller's behalf. That
 * silently lost real money — free shipping on a $799 phone ate
 * $10-15/listing — and broke per-account: `USPSGroundAdvantage`
 * worked for some sellers and got LSAS-rejected for others.
 *
 * Now: return + fulfillment must be supplied by the seller. When
 * missing, we throw `MissingSellerPoliciesError` and the route
 * returns 412 + `next_action: setup_seller_policies` so the agent
 * gathers the few decisions from the user once and POSTs them via
 * `/v1/policies/setup`. Payment policy stays auto — eBay's managed
 * payments program is uniform across sellers, nothing to ask.
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

async function findReturnPolicyId(apiKeyId: string, marketplace: string): Promise<string | null> {
	const list = await sellRequest<ReturnPolicyList>({
		apiKeyId,
		method: "GET",
		path: `/sell/account/v1/return_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
	});
	return list?.returnPolicies?.[0]?.returnPolicyId ?? null;
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

async function findFulfillmentPolicyId(apiKeyId: string, marketplace: string): Promise<string | null> {
	const list = await sellRequest<FulfillmentPolicyList>({
		apiKeyId,
		method: "GET",
		path: `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(marketplace)}`,
	});
	return list?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId ?? null;
}

async function fetchDefaults(apiKeyId: string, marketplace: string): Promise<ResolvedDefaults> {
	// Read-only for return + fulfillment (user must supply via /v1/policies/setup).
	// Payment auto-creates because eBay's managed payments are uniform across sellers.
	// Location is read-only — needs a real address.
	const [ret, pay, ful, locationRes] = await Promise.all([
		findReturnPolicyId(apiKeyId, marketplace),
		ensurePaymentPolicy(apiKeyId, marketplace),
		findFulfillmentPolicyId(apiKeyId, marketplace),
		sellRequest<LocationList>({
			apiKeyId,
			method: "GET",
			path: `/sell/inventory/v1/location`,
		}),
	]);

	const missing: Array<"return" | "fulfillment"> = [];
	if (!ret) missing.push("return");
	if (!ful) missing.push("fulfillment");
	if (missing.length > 0) {
		throw new MissingSellerPoliciesError(missing);
	}

	const loc = locationRes?.locations?.[0]?.merchantLocationKey;
	if (!loc) {
		throw new DefaultsLookupError(
			"missing_listing_prereqs",
			"No merchant location on the eBay account. Create one at POST /v1/locations with the warehouse / forwarder address before listing.",
		);
	}
	return {
		policies: {
			returnPolicyId: ret!,
			paymentPolicyId: pay,
			fulfillmentPolicyId: ful!,
		},
		merchantLocationKey: loc,
	};
}

/**
 * Thrown when the seller's eBay account is missing a return and/or
 * fulfillment policy. Route maps to 412 + a structured next_action so
 * the agent gathers the few values from the user (returns yes/no,
 * handling time, shipping mode/service) and POSTs them via
 * `/v1/policies/setup`.
 */
export class MissingSellerPoliciesError extends Error {
	readonly status = 412;
	readonly missing: ReadonlyArray<"return" | "fulfillment">;
	constructor(missing: Array<"return" | "fulfillment">) {
		super(`Seller account is missing required policies: ${missing.join(", ")}`);
		this.name = "MissingSellerPoliciesError";
		this.missing = missing;
	}
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
