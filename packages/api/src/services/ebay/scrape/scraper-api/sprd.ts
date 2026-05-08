/**
 * SPRD scrape backend. Peer flipagent-shape API at api-dev.sprd.app —
 * GET only with `x-api-key`. SPRD runs the eBay parsers on its own
 * infrastructure and returns Browse / Catalog wire shapes that match
 * what `@flipagent/types/ebay/{buy,commerce}` declares, so this adapter
 * sits one layer ABOVE the HTML-fetch-then-parse pipe that the Oxylabs
 * adapter feeds. The four high-level `scrape*()` entry points dispatch
 * here when `SCRAPER_API_VENDOR=sprd`, skipping `@flipagent/ebay-scraper`
 * entirely on this path.
 *
 * Live-verified 2026-05-07 against the SPRD dev host:
 *   - search: returns `{ url, total, offset, limit, itemSummaries[] }`
 *     (active / browse-layout) or `{ ..., itemSales[] }` (sold). Same
 *     envelope as our `BrowseSearchResponse`. Empty-q + `categoryIds`
 *     resolves to `/b/_/<categoryId>` (Sourcing primary).
 *   - item detail: `{ url, item: <Browse Item> }`. Unwrap `item`.
 *   - catalog product: `{ url, product: <Browse Product> }`. Unwrap.
 *   - catalog search: `{ url, productSummaries[] }`. Already flat
 *     (envelope keys are merged at the top level — passes through).
 *
 * One-shot 1× retry on 5xx — flake observed once during parity probe
 * where the same legacyItemId returned `internal_error` then 200 a few
 * seconds later. Any deeper backoff happens upstream on SPRD's side.
 */

import type { BrowseSearchResponse, ItemDetail } from "@flipagent/types/ebay/buy";
import type { CatalogProduct, CatalogProductSearchResponse, CatalogSearchQuery } from "@flipagent/types/ebay/commerce";
import { config } from "../../../../config.js";
import type { ScrapeSearchInput } from "../client.js";

const TIMEOUT_MS = 90_000;

interface SprdItemEnvelope {
	url?: string;
	item?: ItemDetail;
}

interface SprdProductEnvelope {
	url?: string;
	product?: CatalogProduct;
}

function buildSearchParams(input: ScrapeSearchInput): URLSearchParams {
	const p = new URLSearchParams();
	const q = input.q?.trim();
	if (q) p.set("q", q);
	if (input.soldOnly) p.set("sold", "true");
	if (input.binOnly) p.set("binOnly", "true");
	if (input.auctionOnly) p.set("auctionOnly", "true");
	if (input.sort) p.set("sort", input.sort);
	if (input.conditionIds && input.conditionIds.length > 0) p.set("conditionIds", input.conditionIds.join("|"));
	if (input.categoryIds) p.set("categoryIds", input.categoryIds);
	if (input.aspectFilter) p.set("aspectFilter", input.aspectFilter);
	if (input.gtin) p.set("gtin", input.gtin);
	if (input.offset != null) p.set("offset", String(input.offset));
	if (input.limit != null) p.set("limit", String(input.limit));
	return p;
}

export async function sprdSearch(input: ScrapeSearchInput): Promise<BrowseSearchResponse> {
	const params = buildSearchParams(input);
	const res = await sprdGet<BrowseSearchResponse>(`/v1/marketplaces/ebay/search?${params.toString()}`);
	// SPRD ships an extra `url` field at the top level for debuggability —
	// `BrowseSearchResponse` doesn't declare it, but TypeBox responses are
	// non-strict by default so it just rides along on the wire. Still,
	// drop it before returning so internal callers don't see a foreign key.
	if (res && typeof res === "object" && "url" in res) {
		const { url: _url, ...rest } = res as BrowseSearchResponse & { url?: string };
		return rest as BrowseSearchResponse;
	}
	return res;
}

export async function sprdItemDetail(itemId: string, variationId?: string): Promise<ItemDetail | null> {
	const legacyMatch = /^v1\|(\d+)\|\d+$/.exec(itemId);
	const legacyId = legacyMatch ? legacyMatch[1]! : itemId;
	const path =
		`/v1/marketplaces/ebay/items/${encodeURIComponent(legacyId)}` +
		(variationId ? `?var=${encodeURIComponent(variationId)}` : "");
	try {
		const res = await sprdGet<SprdItemEnvelope>(path);
		return res?.item ?? null;
	} catch {
		return null;
	}
}

export async function sprdCatalogProduct(epid: string): Promise<CatalogProduct | null> {
	try {
		const res = await sprdGet<SprdProductEnvelope>(
			`/v1/marketplaces/ebay/catalog/products/${encodeURIComponent(epid)}`,
		);
		return res?.product ?? null;
	} catch {
		return null;
	}
}

export async function sprdCatalogSearch(query: CatalogSearchQuery): Promise<CatalogProductSearchResponse> {
	const params = new URLSearchParams();
	if (query.q) params.set("q", query.q);
	if (query.gtin) params.set("gtin", query.gtin);
	if (query.mpn) params.set("mpn", query.mpn);
	if (query.category_ids) params.set("category_ids", query.category_ids);
	if (query.aspect_filter) params.set("aspect_filter", query.aspect_filter);
	if (query.fieldgroups) params.set("fieldgroups", query.fieldgroups);
	if (query.limit != null) params.set("limit", String(query.limit));
	if (query.offset != null) params.set("offset", String(query.offset));
	const res = await sprdGet<CatalogProductSearchResponse & { url?: string }>(
		`/v1/marketplaces/ebay/catalog/search?${params.toString()}`,
	);
	if (res && "url" in res) {
		const { url: _url, ...rest } = res;
		return rest;
	}
	return res;
}

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

async function sprdGet<T>(path: string): Promise<T> {
	if (!config.SPRD_API_KEY) throw new Error("sprd_api_key_not_configured");
	const url = `${config.SPRD_API_URL.replace(/\/+$/, "")}${path}`;
	let lastErr: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: "GET",
				headers: { "x-api-key": config.SPRD_API_KEY, accept: "application/json" },
				signal: ctrl.signal,
			});
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				const err = new Error(`sprd_http_${res.status}: ${body.slice(0, 200)}`);
				if (attempt === 0 && RETRYABLE_STATUSES.has(res.status)) {
					lastErr = err;
					await new Promise((r) => setTimeout(r, 250));
					continue;
				}
				throw err;
			}
			return (await res.json()) as T;
		} catch (err) {
			lastErr = err;
			if (attempt === 0 && isAbortOrNetwork(err)) {
				await new Promise((r) => setTimeout(r, 250));
				continue;
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastErr ?? new Error("sprd_unknown_error");
}

function isAbortOrNetwork(err: unknown): boolean {
	if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) return true;
	return false;
}
