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
	const params: EbaySearchParams = {
		keyword: input.q,
		soldOnly: input.soldOnly,
		auctionOnly: input.auctionOnly,
		binOnly: input.binOnly,
		sort: input.sort,
		conditionIds: input.conditionIds,
		pages: 1,
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

export async function scrapeItemDetail(itemId: string): Promise<ItemDetail | null> {
	const url = `https://www.ebay.com/itm/${encodeURIComponent(itemId)}`;
	try {
		const html = await fetchHtmlViaScraperApi(url);
		const raw = parseEbayDetailHtml(html, url, domFactory);
		return ebayDetailToBrowse(raw);
	} catch {
		return null;
	}
}
