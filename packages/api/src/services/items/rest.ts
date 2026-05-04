/**
 * Body-returning REST fetchers for the eBay Browse + Marketplace
 * Insights endpoints the items composers dispatch to. Used internally
 * by `services/search.ts` (which `routes/v1/items.ts` calls).
 * Parses the body, throws `ListingsError` on transport failure, and
 * stays paper-thin — caching + observation archive happen in the
 * service layer above.
 */

import type { EbayVariation } from "@flipagent/ebay-scraper";
import type { BrowseSearchQuery, BrowseSearchResponse, ItemDetail, SoldSearchQuery } from "@flipagent/types/ebay/buy";
import { config } from "../../config.js";
import { getAppAccessToken } from "../../services/ebay/oauth.js";
import { reconcileBuyingOptions } from "../../services/ebay/scrape/normalize.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { toCents } from "../shared/money.js";
import { ListingsError, MultiVariationParentError } from "./errors.js";

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
	// `q` is optional when category_ids/gtin/epid is provided (eBay's
	// "at least one" rule). Don't set the param when empty — passing
	// `q=` literally has worked historically but eBay docs say omit.
	if (query.q) params.set("q", query.q);
	if (query.filter) params.set("filter", query.filter);
	if (query.sort) params.set("sort", query.sort);
	if (query.limit != null) params.set("limit", String(query.limit));
	if (query.offset != null) params.set("offset", String(query.offset));
	if (query.category_ids) params.set("category_ids", query.category_ids);
	// eBay-spec optional params, forwarded verbatim. Names stay snake_case
	// to match eBay's URL contract — agents reading eBay's docs find each
	// query string identical between docs and our mirror.
	if (query.aspect_filter) params.set("aspect_filter", query.aspect_filter);
	if (query.gtin) params.set("gtin", query.gtin);
	if (query.epid) params.set("epid", query.epid);
	if (query.fieldgroups) params.set("fieldgroups", query.fieldgroups);
	if (query.auto_correct) params.set("auto_correct", query.auto_correct);
	if (query.compatibility_filter) params.set("compatibility_filter", query.compatibility_filter);
	if (query.charity_ids) params.set("charity_ids", query.charity_ids);
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
	// Marketplace Insights' subset of optional params — matches eBay's spec
	// (no sort / auto_correct / compatibility_filter / charity_ids on sold).
	if (query.aspect_filter) params.set("aspect_filter", query.aspect_filter);
	if (query.gtin) params.set("gtin", query.gtin);
	if (query.epid) params.set("epid", query.epid);
	if (query.fieldgroups) params.set("fieldgroups", query.fieldgroups);
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
	// returns errorId 11006 ("legacy Id is invalid") and points at
	// `get_items_by_item_group` via an `itemGroupHref` parameter. We catch
	// that below and re-throw as `MultiVariationParentError` carrying the
	// enumerated variations so the caller can pick one and retry.
	if (opts.variationId) params.set("legacy_variation_id", opts.variationId);
	try {
		const detail = (await callBrowseRest("/buy/browse/v1/item/get_item_by_legacy_id", params, opts)) as ItemDetail;
		// eBay Browse REST drops the AUCTION enum on hybrid Auction-with-BIN
		// listings once bidding has pushed past the BIN floor — the response
		// reads `buyingOptions: ["FIXED_PRICE"]` even though `bidCount` is
		// non-zero and the auction is still counting down. Reconciler
		// promotes those back to ["AUCTION"]. See `reconcileBuyingOptions`.
		return reconcileBuyingOptions(detail);
	} catch (err) {
		if (err instanceof ListingsError && isMultiVariationParent(err)) {
			const variations = await fetchItemGroupVariationsRest(legacyId, opts);
			throw new MultiVariationParentError(legacyId, variations);
		}
		throw err;
	}
}

interface EbayErrorEnvelope {
	errors?: Array<{ errorId?: number }>;
}

function isMultiVariationParent(err: ListingsError): boolean {
	const env = err.body as EbayErrorEnvelope | null | undefined;
	return env?.errors?.some((e) => e.errorId === 11006) === true;
}

interface ItemGroupResponse {
	items?: Array<{
		itemId?: string;
		price?: { value?: string; currency?: string };
		localizedAspects?: Array<{ name?: string; value?: string }>;
		/** Per-variation image. eBay populates this for SKUs with their
		 *  own photo (color-distinct apparel, swatches, etc). Surfaced
		 *  to the variation picker so the user sees what they're
		 *  picking instead of just an aspect string. */
		image?: { imageUrl?: string };
	}>;
}

/**
 * Enumerate every SKU in a multi-variation parent group. Mirrors the
 * `EbayVariation[]` shape that scrape produces from the page MSKU model
 * so callers see the same structure regardless of which transport
 * surfaced the parent.
 *
 * The variation legacy id sits in the third segment of the
 * `v1|<parent>|<variationId>` itemId — that's the same id eBay accepts
 * back as `legacy_variation_id` on a follow-up `get_item_by_legacy_id`
 * call, and the same id the web URL uses as `?var=`.
 */
async function fetchItemGroupVariationsRest(legacyId: string, opts: RestRequestOptions): Promise<EbayVariation[]> {
	const params = new URLSearchParams({ item_group_id: legacyId });
	const body = (await callBrowseRest(
		"/buy/browse/v1/item/get_items_by_item_group",
		params,
		opts,
	)) as ItemGroupResponse;
	const items = body.items ?? [];
	const out: EbayVariation[] = [];
	for (const it of items) {
		const variationId = parseVariationIdFromItemId(it.itemId);
		if (!variationId) continue;
		const aspects = (it.localizedAspects ?? [])
			.map((a) => ({ name: a.name ?? "", value: a.value ?? "" }))
			.filter((a) => a.name && a.value);
		out.push({
			variationId,
			priceCents: it.price?.value ? toCents(it.price.value) : null,
			currency: it.price?.currency ?? "USD",
			aspects,
			...(it.image?.imageUrl ? { imageUrl: it.image.imageUrl } : {}),
		});
	}
	return out;
}

function parseVariationIdFromItemId(itemId: string | undefined): string | null {
	if (!itemId) return null;
	const m = /^v1\|\d+\|(\d+)$/.exec(itemId);
	return m && m[1] !== "0" ? m[1]! : null;
}
