/**
 * Scrape backend for the eBay-compat surface. Uses **only** the Oxylabs
 * Web Scraper API. We POST a URL, they return rendered HTML. Reliable
 * for eBay. Whatever rendering / IP rotation / JavaScript execution
 * Oxylabs does on their side is their product; we are just an HTTPS
 * client. flipagent's own code path runs no UA rotation logic, no
 * browser fingerprinting, and no scrape retry policies — anything of
 * that nature would be on Oxylabs's infrastructure, under their ToS
 * with the upstream marketplace.
 *
 * Self-hosters who don't want this dependency should set
 * `EBAY_LISTINGS_SOURCE=bridge` (free, uses the user's extension) or
 * `EBAY_LISTINGS_SOURCE=rest` (Browse REST, 5000 calls/day quota).
 */

import {
	buildEbayUrl,
	type EbaySearchParams,
	parseEbayDetailHtml,
	parseEbaySearchHtml,
	parseResultCount,
} from "@flipagent/ebay-scraper";
import type { BrowseSearchResponse, ItemDetail } from "@flipagent/types/ebay/buy";
import { JSDOM } from "jsdom";
import { ebayDetailToBrowse } from "../../listings/transform.js";
import { fetchHtmlViaScraperApi } from "./scraper-api/index.js";

const domFactory = (html: string) => new JSDOM(html).window.document as unknown as ParentNode;

export interface ScrapeSearchInput {
	q: string;
	soldOnly?: boolean;
	auctionOnly?: boolean;
	binOnly?: boolean;
	sort?: EbaySearchParams["sort"];
	/** Pipe-joined into eBay's `LH_ItemCondition`. Same numeric enum as Browse `conditionIds`. */
	conditionIds?: string[];
	limit?: number;
	/**
	 * Pagination offset, in *items*. Translates to eBay's per-page `_pgn`
	 * (eBay search-page renders ~60 cards per page) plus a client-side
	 * slice within the page. Capped at the same offset+limit ≤ 10000
	 * ceiling REST applies — eBay's web SRP technically goes further
	 * but we don't expose that since the REST mirror can't.
	 */
	offset?: number;
	/**
	 * Pipe-joined Browse category ids. Web SRP scopes by a single leaf
	 * category, so the first id wins; later ones are dropped (the demand-
	 * pulse archive still records the full list).
	 */
	categoryIds?: string;
	/**
	 * eBay-spec `aspect_filter` expression
	 * (`categoryId:N,Color:{Black|Red},Size:{8}`). Parsed into per-aspect
	 * URL params on the SRP — eBay's web search keys aspects by name
	 * (`Color`, `US Shoe Size`, …), so a clicked-facet URL drops in.
	 */
	aspectFilter?: string;
	/**
	 * UPC / EAN / ISBN. Folded into the keyword query (`_nkw=<q> <gtin>`)
	 * since web SRP has no dedicated GTIN axis. Best-effort: only listings
	 * whose seller put the GTIN in the title or aspects show up.
	 */
	gtin?: string;
}

/**
 * eBay's web search results page renders ~60 cards per page. The
 * exact number drifts (older categories, sponsored injections), but
 * 60 is the modal page size and what `_pgn` advances by. Used here
 * only for offset → page number math; we still slice to the caller's
 * `limit` after parsing.
 */
const EBAY_SRP_PAGE_SIZE = 60;
const SCRAPE_PAGINATION_CAP = 10000;

/**
 * Parse eBay's `aspect_filter` expression into the categoryId + per-
 * aspect dict the web-SRP URL builder consumes. Spec format
 * (https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html):
 *
 *   `categoryId:<id>,Aspect1:{Value1|Value2},Aspect2:{Value}`
 *
 * The categoryId prefix is REQUIRED by eBay; if absent, we still emit
 * any aspect pairs we can parse (the SRP just won't have a category
 * scope and aspect facets may not narrow as expected — eBay's choice).
 *
 * Splitting top-level commas is safe — eBay's spec doesn't allow
 * commas inside aspect values, only pipes.
 */
export function parseAspectFilter(input: string): {
	categoryId?: string;
	aspects: Record<string, string>;
} {
	const aspects: Record<string, string> = {};
	let categoryId: string | undefined;
	for (const part of input.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("categoryId:")) {
			categoryId = trimmed.slice("categoryId:".length);
			continue;
		}
		const m = trimmed.match(/^([^:]+):\{([^}]+)\}$/);
		if (m) {
			const [, name, values] = m;
			if (name && values) aspects[name] = values;
		}
	}
	return { categoryId, aspects };
}

export async function scrapeSearch(input: ScrapeSearchInput): Promise<BrowseSearchResponse> {
	const offset = Math.max(0, input.offset ?? 0);
	if (offset > SCRAPE_PAGINATION_CAP) {
		// Match REST's behaviour: deep paging beyond 10K is not exposed.
		// Surface as an empty page rather than 4xx — the route layer
		// already handles the friendly framing.
		return input.soldOnly
			? { itemSales: [], total: 0, offset, limit: input.limit ?? 0 }
			: { itemSummaries: [], total: 0, offset, limit: input.limit ?? 0 };
	}
	const ebayPage = Math.floor(offset / EBAY_SRP_PAGE_SIZE) + 1;
	const sliceStart = offset % EBAY_SRP_PAGE_SIZE;
	// Translate eBay-spec mirror params to web-SRP equivalents.
	//   - `_dcat` (category) + `LH_*` (sold / BIN / auction / condition)
	//     are honoured by eBay's web SRP one-to-one.
	//   - `aspect_filter` is parsed and forwarded as `&AspectName=Value`
	//     URL params. Verified end-to-end against live eBay (May 2026):
	//     **the web SRP does NOT narrow on URL-based aspect params** —
	//     facets are applied JS-side via the sidebar checkbox state and
	//     AJAX-replaced result list. The URL `&AspectName=Value` keys
	//     eBay's UI emits are used only for chip rendering. We still
	//     forward (cost-free, audit-readable, future-proof if eBay
	//     consolidates URL+JS filtering) — but **for precise aspect
	//     narrowing, callers must use the REST source**, where
	//     `aspect_filter={Value}` narrows correctly.
	//   - `gtin` folds into the keyword query — best-effort, since web
	//     SRP has no dedicated GTIN axis.
	//   - `epid` / `fieldgroups` / `auto_correct` / `compatibility_filter`
	//     / `charity_ids` silently drop — no web-SRP equivalent.
	const aspect = input.aspectFilter ? parseAspectFilter(input.aspectFilter) : null;
	const categoryId = aspect?.categoryId ?? input.categoryIds?.split("|")[0] ?? undefined;
	const params: EbaySearchParams = {
		keyword: input.q,
		soldOnly: input.soldOnly,
		auctionOnly: input.auctionOnly,
		binOnly: input.binOnly,
		sort: input.sort,
		conditionIds: input.conditionIds,
		pages: 1,
		categoryId,
		aspectParams: aspect?.aspects,
		extraKeywords: input.gtin,
	};
	const url = buildEbayUrl(params, ebayPage);
	const html = await fetchHtmlViaScraperApi(url);
	const items = parseEbaySearchHtml(html, params, domFactory);
	const total = parseResultCount(domFactory(html)) ?? items.length;
	// Slice within the fetched page first (offset within the page),
	// then cap at limit. When `limit` straddles the page boundary the
	// tail is silently dropped — matches REST behaviour where requesting
	// items past the end returns fewer than `limit`.
	const sliced = items.slice(sliceStart, input.limit ? sliceStart + input.limit : undefined);
	const envelope = { total, offset, limit: input.limit ?? sliced.length };
	return params.soldOnly ? { itemSales: sliced, ...envelope } : { itemSummaries: sliced, ...envelope };
}

export async function scrapeItemDetail(itemId: string, variationId?: string): Promise<ItemDetail | null> {
	// eBay's web /itm/ path uses the legacy numeric id, not the v1 envelope.
	// Strip `v1|<legacy>|<version>` → `<legacy>` so callers can pass either form.
	const legacyMatch = /^v1\|(\d+)\|\d+$/.exec(itemId);
	const legacyId = legacyMatch ? legacyMatch[1]! : itemId;
	// `?var=<n>` selects a specific variation on multi-SKU listings
	// (sneakers, clothes, bags). Without it eBay default-renders one
	// variation server-side — usually the cheapest — so the price + per-
	// variation aspects we extract would belong to the wrong SKU.
	const base = `https://www.ebay.com/itm/${encodeURIComponent(legacyId)}`;
	const url = variationId ? `${base}?var=${encodeURIComponent(variationId)}` : base;
	try {
		const html = await fetchHtmlViaScraperApi(url);
		const raw = parseEbayDetailHtml(html, url, domFactory);
		return ebayDetailToBrowse(raw, variationId);
	} catch {
		return null;
	}
}
