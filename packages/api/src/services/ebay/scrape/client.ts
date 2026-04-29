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
}

export async function scrapeSearch(input: ScrapeSearchInput): Promise<BrowseSearchResponse> {
	const params: EbaySearchParams = {
		keyword: input.q,
		soldOnly: input.soldOnly,
		auctionOnly: input.auctionOnly,
		binOnly: input.binOnly,
		sort: input.sort,
		conditionIds: input.conditionIds,
		pages: 1,
	};
	const url = buildEbayUrl(params, 1);
	const html = await fetchHtmlViaScraperApi(url);
	const items = parseEbaySearchHtml(html, params, domFactory);
	const total = parseResultCount(domFactory(html)) ?? items.length;
	const result: BrowseSearchResponse = params.soldOnly ? { itemSales: items, total } : { itemSummaries: items, total };
	if (input.limit) {
		if (result.itemSummaries) result.itemSummaries = result.itemSummaries.slice(0, input.limit);
		if (result.itemSales) result.itemSales = result.itemSales.slice(0, input.limit);
	}
	return result;
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
