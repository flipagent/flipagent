# @flipagent/scraper

## [Unreleased]

### Added

- `scrapeEbaySearchInBrowser` — Chromium-backed scraper that produces the canonical eBay Browse `ItemSummary[]` shape. Reuses a persistent `BrowserSession` named `ebay-public`; first call ~3–5s, subsequent calls ~1–2s with cookies accumulated.
- `EbayItemSummary` type mirroring `buy_browse_v1_oas3.json#ItemSummary` — same shape both backends emit.
- `endDateFromTimeLeft`, `timeLeftFromEndDate`, `normalizeBuyingFormat` parsers in `ebay-extract.ts`.
- `BrowserSession.content()` and `BrowserSession.waitForSelector()` helpers.
- BrowserManager with context pooling.
- eBay search extractor.
- ScraperWorker daemon polling `scrape_jobs`.
- `enqueueSearchJob` / `enqueueDetailJob` convenience helpers for the CLI.

### Changed

- Selectors updated for eBay's 2025+ `s-card` web-component layout (was `s-item`). `extractEbayItems` walks `.s-card__attribute-row` text nodes to extract watcher count, shipping, buying option, bid count, time left, sold date, and seller feedback — eBay no longer emits class-named markers for these. Backward-compat with `s-item` retained for fixtures.
- `scrapeEbaySearch` (raw HTTP) deprecated for sustained reads — kept for one-shot tests. eBay's bot wall throttles datacenter HTTP to empty/thin responses after a handful of bursts; the Chromium variant is the production path.
- `fetchHtml` raises `HttpBlockedError` on `/sch/` responses below 50KB (eBay's bot wall returns 200 + tiny body silently). Headers updated to `Accept-Language: en-US,en;q=0.9` and Sec-Fetch-* hints.
- `ScraperWorker` daemon now drives `scrapeEbaySearchInBrowser` for the `ebay_search` job kind.
