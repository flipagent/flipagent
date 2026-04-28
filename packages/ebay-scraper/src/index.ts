/**
 * Pure parsers + URL builder + types + robots-guard. No fetcher —
 * callers bring their own HTTP client (managed scraping API, browser
 * extension, server-side `fetch`, whatever). Keeping fetch policy out
 * of this package on purpose: anti-bot fingerprint rotation belongs
 * either to a dedicated vendor (Oxylabs Web Scraper API, Bright Data
 * Web Unlocker) or to the user's own browser session via the bridge
 * primitive — not to a generic OSS scraper.
 */

export * from "./ebay-extract.js";
export * from "./ebay-search.js";
export * from "./robots-guard.js";
