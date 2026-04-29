/**
 * Pure parsers + URL builder + types + robots-guard. No fetcher —
 * callers bring their own HTTP client (managed scraping API, browser
 * extension, server-side `fetch`, whatever). Keeping fetch policy
 * out of this package on purpose: how a page actually loads is the
 * caller's concern, not a parser's. Production callers either use a
 * dedicated managed Web Scraper API (Oxylabs, Bright Data) or run
 * the read inside the user's own browser session via flipagent's
 * bridge primitive.
 */

export * from "./ebay-extract.js";
export * from "./ebay-search.js";
export * from "./robots-guard.js";
