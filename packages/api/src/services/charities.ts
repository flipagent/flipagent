/**
 * commerce/charity — search + get charity organizations.
 */

import type { CharitiesListQuery, Charity } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { fetchRetry } from "../utils/fetch-retry.js";
import { getAppAccessToken } from "./ebay/oauth.js";

interface EbayCharity {
	charityOrgId: string;
	ein?: string;
	name: string;
	mission?: string;
	description?: string;
	logo?: { imageUrl?: string };
	websiteUrl?: string;
}

function toFlipagent(c: EbayCharity): Charity {
	return {
		id: c.charityOrgId,
		...(c.ein ? { ein: c.ein } : {}),
		name: c.name,
		...(c.mission ? { mission: c.mission } : {}),
		...(c.description ? { description: c.description } : {}),
		...(c.logo?.imageUrl ? { logoUrl: c.logo.imageUrl } : {}),
		...(c.websiteUrl ? { websiteUrl: c.websiteUrl } : {}),
	};
}

async function appRequest<T>(path: string): Promise<T | null> {
	if (!isEbayAppConfigured()) return null;
	const token = await getAppAccessToken();
	const res = await fetchRetry(`${config.EBAY_BASE_URL}${path}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
	});
	if (!res.ok) return null;
	return (await res.json()) as T;
}

export async function listCharities(
	q: CharitiesListQuery,
): Promise<{ charities: Charity[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.q) params.set("q", q.q);
	if (q.ein) params.set("ein", q.ein);
	const res = await appRequest<{ charityOrgs?: EbayCharity[]; total?: number }>(
		`/commerce/charity/v1/charity_org?${params.toString()}`,
	);
	return {
		charities: (res?.charityOrgs ?? []).map(toFlipagent),
		limit,
		offset,
		...(res?.total !== undefined ? { total: res.total } : {}),
	};
}

export async function getCharity(idOrEin: string): Promise<Charity | null> {
	const res = await appRequest<EbayCharity>(`/commerce/charity/v1/charity_org/${encodeURIComponent(idOrEin)}`);
	return res ? toFlipagent(res) : null;
}
