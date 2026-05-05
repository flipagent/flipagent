/**
 * Buy Browse `check_compatibility` + Commerce Taxonomy
 * `compatibility_property` reads.
 */

import type { CompatibilityCheckRequest, CompatibilityCheckResponse, CompatibilityProperty } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { fetchRetry } from "../utils/fetch-retry.js";
import { getAppAccessToken } from "./ebay/oauth.js";

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
