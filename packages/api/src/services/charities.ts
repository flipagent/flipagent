/**
 * commerce/charity — search + get charity organizations.
 *
 * Verified live 2026-05-02: this API is user-OAuth only at the app
 * level — the same call with an app-credential token returns errorId
 * 165001 ("Invalid, missing or unsupported marketplace"), which is
 * eBay's standard 4xx for "this app credential isn't approved for the
 * Commerce Charity API". Switching to the user OAuth pipe (any user
 * with our default scopes) returns 200. Routes therefore take an
 * `apiKeyId` so we can resolve their user token.
 */

import type { CharitiesListQuery, Charity } from "@flipagent/types";
import { sellRequest, swallow404 } from "./ebay/rest/user-client.js";

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

export interface CharityContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function listCharities(
	q: CharitiesListQuery,
	ctx: CharityContext,
): Promise<{ charities: Charity[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.q) params.set("q", q.q);
	// eBay's Charity API uses `registration_ids` (comma-separated) for
	// EIN-style lookups, not `ein` — the `ein` query param does not
	// exist. flipagent's surface keeps `ein` for ergonomics; the
	// translation happens here.
	if (q.ein) params.set("registration_ids", q.ein);
	const res = await swallow404(
		sellRequest<{ charityOrgs?: EbayCharity[]; total?: number }>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/commerce/charity/v1/charity_org?${params.toString()}`,
			marketplace: ctx.marketplace ?? "EBAY_US",
		}),
	);
	return {
		charities: (res?.charityOrgs ?? []).map(toFlipagent),
		limit,
		offset,
		...(res?.total !== undefined ? { total: res.total } : {}),
	};
}

export async function getCharity(idOrLegacyId: string, ctx: CharityContext): Promise<Charity | null> {
	// eBay distinguishes `charity_org_id` (its own opaque id) from
	// `legacy_charity_org_id` (the v3-era integer). Numeric input → try
	// the legacy lookup first, otherwise the canonical id route.
	const isLegacy = /^\d+$/.test(idOrLegacyId);
	const path = isLegacy
		? `/commerce/charity/v1/charity_org/get_by_legacy_id?legacy_charity_org_id=${encodeURIComponent(idOrLegacyId)}`
		: `/commerce/charity/v1/charity_org/${encodeURIComponent(idOrLegacyId)}`;
	const res = await swallow404(
		sellRequest<EbayCharity>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path,
			marketplace: ctx.marketplace ?? "EBAY_US",
		}),
	);
	return res ? toFlipagent(res) : null;
}
