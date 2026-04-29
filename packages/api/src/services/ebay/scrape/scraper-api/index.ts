/**
 * Scraper API dispatcher. Vendor-agnostic surface: callers ask for HTML
 * by URL, the configured vendor (env: `SCRAPER_API_VENDOR`) handles the
 * fetch.
 *
 * Why a dispatcher and not a single adapter file: managed scraping
 * vendors don't agree on a wire shape. Oxylabs takes JSON over POST
 * with Basic auth. Bright Data Web Unlocker is an HTTP-CONNECT proxy.
 * ScrapingBee / ScraperAPI are GET with API key in the query string.
 * Zyte API is POST with `browserHtml: true`. Each adapter knows its
 * own request/response shape; this file only picks which one to call.
 *
 * Today: oxylabs only. Adding a new vendor = drop a `./<vendor>.ts`
 * adapter and a case here.
 */

import { config } from "../../../../config.js";
import { fetchHtmlViaOxylabs } from "./oxylabs.js";

export async function fetchHtmlViaScraperApi(targetUrl: string): Promise<string> {
	switch (config.SCRAPER_API_VENDOR) {
		case "oxylabs":
			return fetchHtmlViaOxylabs(targetUrl);
		default:
			throw new Error(`scraper_api_vendor_unsupported: ${config.SCRAPER_API_VENDOR}`);
	}
}
