/**
 * Buy Browse `check_compatibility` + Commerce Taxonomy
 * `compatibility_property` reads.
 */

import type { CompatibilityCheckRequest, CompatibilityCheckResponse, CompatibilityProperty } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { fetchRetry } from "../utils/fetch-retry.js";
import { getAppAccessToken } from "./ebay/oauth.js";
import { EbayApiError } from "./ebay/rest/user-client.js";

async function appRequest<T>(opts: { method?: "GET" | "POST"; path: string; body?: unknown }): Promise<T | null> {
	if (!isEbayAppConfigured()) return null;
	const token = await getAppAccessToken();
	const res = await fetchRetry(`${config.EBAY_BASE_URL}${opts.path}`, {
		method: opts.method ?? "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			"X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
			...(opts.body ? { "Content-Type": "application/json" } : {}),
		},
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	if (!res.ok) return null;
	return (await res.json()) as T;
}

export async function checkCompatibility(input: CompatibilityCheckRequest): Promise<CompatibilityCheckResponse> {
	const res = await appRequest<{ compatibilityStatus: string; warnings?: Array<{ message?: string }> }>({
		method: "POST",
		path: `/buy/browse/v1/item/${encodeURIComponent(input.itemId)}/check_compatibility`,
		body: { compatibilityProperties: input.compatibilityProperties },
	});
	return {
		compatible: res?.compatibilityStatus === "COMPATIBLE",
		...(res?.warnings ? { warnings: res.warnings.map((w) => w.message ?? "").filter(Boolean) } : {}),
	};
}

export async function getCompatibilityProperties(
	categoryId: string,
	categoryTreeId: string,
): Promise<{ properties: CompatibilityProperty[] }> {
	const res = await appRequest<{
		compatibilityProperties?: Array<{ name: string; localizedName?: string }>;
	}>({
		path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_compatibility_properties?category_id=${encodeURIComponent(categoryId)}`,
	});
	return {
		properties: (res?.compatibilityProperties ?? []).map((p) => ({
			name: p.name,
			...(p.localizedName ? { localizedName: p.localizedName } : {}),
		})),
	};
}

/**
 * `findEligibleAuctionItems` — there is no eBay REST endpoint for "find
 * auction items I'm eligible to bid on." The previous wrapper called
 * `/buy/offer/v1/find_eligible_items` (made-up path; verified live
 * 2026-05-03 — both `v1` and `v1_beta` 404). The closest equivalents
 * are: (a) Trading `GetMyeBayBuying.BiddingList` for bids already placed
 * (wrapped at `services/me-overview.ts`), (b) Browse search with
 * `filter=buyingOptions:{AUCTION}` to find live auctions
 * (`/v1/items?status=auction` calls this).
 *
 * The caller-facing route `/v1/bids/eligible-listings` therefore returns
 * an explanatory 501 rather than silently swallowing a 404 from a
 * phantom endpoint.
 */
export async function findEligibleAuctionItems(): Promise<never> {
	throw new EbayApiError(
		501,
		"endpoint_does_not_exist",
		"eBay has no REST endpoint for 'find eligible auctions'. Use /v1/items?status=auction (Browse search) or /v1/me/buying (Trading GetMyeBayBuying.BiddingList) instead.",
	);
}
