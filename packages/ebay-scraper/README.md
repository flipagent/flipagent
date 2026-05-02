# @flipagent/ebay-scraper

Plain-HTTP fetch + DOM-based parsers for eBay public search and detail pages.
Standalone — bring your own HTTP client, proxy, retry policy, and OAuth.

```bash
npm install @flipagent/ebay-scraper jsdom
```

```ts
import { JSDOM } from "jsdom";
import { fetchEbaySearch } from "@flipagent/ebay-scraper";

const domFactory = (html: string) => new JSDOM(html).window.document;
const result = await fetchEbaySearch({ keyword: "canon ef 50mm 1.8", pages: 1 }, domFactory);
console.log(result.itemSummaries?.length, "active listings");
```

## What this package is

A thin parser. It builds eBay search URLs, fetches HTML over plain HTTPS,
and turns the page into the same `ItemSummary` shape you'd get back from the
official eBay Browse API. That's it.

## What this package is not

- Not a proxy pool. Datacenter HTTP gets throttled under sustained traffic;
  bring your own residential proxies / rotation if you intend to poll heavily.
- Not a browser automation harness. Server-rendered pages only. If a page
  requires JS, this package won't see it.
- Not a database. Caching, deduplication, persistence are caller concerns.
- Not a license to redistribute eBay content. Read the terms section below.

## ⚠️ Terms of service

This package is provided for educational and personal use. eBay's
[User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement)
and [API License Agreement](https://developer.ebay.com/join/api-license-agreement)
restrict automated access and redistribution of listing content. **You are
solely responsible for complying with eBay's terms.** Specifically:

- Do not redistribute raw listing content (title, description, photos,
  seller details). Aggregated/derived statistics are generally safe.
- Respect rate limits. Sustained heavy polling will result in throttled
  responses and may trigger an IP ban.
- For commercial use, prefer the official
  [eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html)
  and [Marketplace Insights API](https://developer.ebay.com/api-docs/buy/marketplace_insights/overview.html)
  with your own OAuth credentials.

The hosted flipagent API documents its takedown channel and incident-
response commitments at
[flipagent.dev/legal/compliance](https://flipagent.dev/legal/compliance).
Self-hosters operate their own instance under their own posture.

The `flipagent/flipagent` repository ships a hosted convenience layer
(`@flipagent/api`, `api.flipagent.dev`) that handles proxy rotation
and serves pre-aggregated sold-price datasets. See repo root README.

## API

### `fetchEbaySearch(params, domFactory): Promise<BrowseSearchResponse>`

Mirrors the eBay Browse API `SearchPagedCollection` envelope. Active searches
populate `itemSummaries`; sold searches (`{ soldOnly: true }`) populate
`itemSales`.

### `fetchEbayItemDetail(url, domFactory): Promise<EbayItemDetail>`

Single-page detail fetch + parse.

### `fetchHtml(url, options?): Promise<string>`

Lower-level HTTPS fetch with rotating User-Agent. Throws `HttpBlockedError`
on 403/429/503 or suspiciously thin responses (eBay's "200 with empty body"
pattern).

### `parseEbaySearchHtml(html, params, domFactory)`

If you already have HTML (fixture, your own fetcher with proxies), bypass the
network and parse directly.

## License

MIT. See `LICENSE` at the repo root.
