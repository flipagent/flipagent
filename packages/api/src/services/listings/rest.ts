/**
 * Body-returning REST fetchers for the eBay Browse + Marketplace
 * Insights endpoints the listings composers dispatch to. The generic
 * `ebayPassthroughApp` (used by every other `/sell/*` and `/commerce/*`
 * route) hands back a streamed `Response` — fine for blind passthrough
 * but unusable for the listings layer, which needs to write to the
 * response cache and feed the observation archive.
 *
 * These wrappers parse the body, throw `ListingsError` on transport
 * failure, and otherwise stay paper-thin — no caching, no archive
 * hooks, no source-dispatch. Composition lives in the search/sold/
 * detail services.
 */

import type { BrowseSearchQuery, BrowseSearchResponse, ItemDetail, SoldSearchQuery } from "@flipagent/types/ebay/buy";
import { config } from "../../config.js";
import { getAppAccessToken } from "../../services/ebay/oauth.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { ListingsError } from "./errors.js";

export interface RestRequestOptions {
	/** Override marketplace for this request. Default `EBAY_US`. */
	marketplace?: string;
	acceptLanguage?: string;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function callBrowseRest(path: string, params: URLSearchParams, opts: RestRequestOptions): Promise<unknown> {
	let token: string;
	try {
		token = await getAppAccessToken();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new ListingsError("upstream_failed", 502, msg);
	}
	const url = `${config.EBAY_BASE_URL}${path}?${params}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
		"X-EBAY-C-MARKETPLACE-ID": opts.marketplace ?? "EBAY_US",
	};
	if (opts.acceptLanguage) headers["Accept-Language"] = opts.acceptLanguage;

	let upstream: Response;
	try {
		upstream = await fetchRetry(url, { headers });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new ListingsError("upstream_failed", 502, msg);
	}
	const text = await upstream.text();
	if (!upstream.ok) {
		const parsed = safeJson(text);
		const status = upstream.status === 404 ? 404 : upstream.status >= 500 ? 502 : upstream.status;
		throw new ListingsError("upstream_failed", status, `eBay ${upstream.status}`, parsed ?? { raw: text });
	}
	return safeJson(text);
}

export async function fetchActiveSearchRest(
	query: BrowseSearchQuery,
	opts: RestRequestOptions = {},
): Promise<BrowseSearchResponse> {
	const params = new URLSearchParams();
	params.set("q", query.q);
	if (query.filter) params.set("filter", query.filter);
	if (query.sort) params.set("sort", query.sort);
	if (query.limit != null) params.set("limit", String(query.limit));
	if (query.offset != null) params.set("offset", String(query.offset));
	if (query.category_ids) params.set("category_ids", query.category_ids);
	return (await callBrowseRest("/buy/browse/v1/item_summary/search", params, opts)) as BrowseSearchResponse;
}

export async function fetchSoldSearchRest(
	query: SoldSearchQuery,
	opts: RestRequestOptions = {},
): Promise<BrowseSearchResponse> {
	const params = new URLSearchParams();
	params.set("q", query.q);
	params.set("limit", String(query.limit ?? 50));
	if (query.offset != null && query.offset > 0) params.set("offset", String(query.offset));
	if (query.filter) params.set("filter", query.filter);
	if (query.category_ids) params.set("category_ids", query.category_ids);
	return (await callBrowseRest(
		"/buy/marketplace_insights/v1_beta/item_sales/search",
		params,
		opts,
	)) as BrowseSearchResponse;
}

export async function fetchItemDetailRest(
	legacyId: string,
	opts: RestRequestOptions & { variationId?: string } = {},
): Promise<ItemDetail> {
	const params = new URLSearchParams({ legacy_item_id: legacyId });
	// `legacy_variation_id` selects one SKU from a multi-variation listing
	// (sneakers / clothes / bags). Without it eBay's get_item_by_legacy_id
	// 11001s on parents OR returns a server-picked default variation —
	// neither matches the variation the caller actually asked about.
	if (opts.variationId) params.set("legacy_variation_id", opts.variationId);
	return (await callBrowseRest("/buy/browse/v1/item/get_item_by_legacy_id", params, opts)) as ItemDetail;
}
