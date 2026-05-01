<h3 align="center">
  <a name="readme-top"></a>
  <img
    src="https://raw.githubusercontent.com/flipagent/flipagent/main/apps/docs/public/logo.png"
    height="110"
    alt="flipagent"
  >
</h3>

<div align="center">
  <a href="#license">
    <img src="https://img.shields.io/badge/license-MIT%20%2F%20FSL-blue.svg" alt="License">
  </a>
  <a href="https://www.npmjs.com/package/@flipagent/sdk">
    <img src="https://img.shields.io/npm/v/@flipagent/sdk.svg?label=%40flipagent%2Fsdk" alt="SDK on npm">
  </a>
  <a href="https://www.npmjs.com/package/flipagent-mcp">
    <img src="https://img.shields.io/npm/v/flipagent-mcp.svg?label=flipagent-mcp" alt="MCP on npm">
  </a>
  <a href="https://github.com/flipagent/flipagent/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/flipagent/flipagent.svg" alt="Contributors">
  </a>
  <a href="https://flipagent.dev">
    <img src="https://img.shields.io/badge/visit-flipagent.dev-orange" alt="Visit flipagent.dev">
  </a>
</div>

<div>
  <p align="center">
    <a href="https://discord.gg/PUyURdjMtv">
      <img src="https://img.shields.io/badge/Join%20our%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord">
    </a>
    <a href="https://flipagent.dev/signup">
      <img src="https://img.shields.io/badge/Get%20a%20free%20key-000000?style=for-the-badge&logoColor=white" alt="Get a free key">
    </a>
  </p>
</div>

---

# **flipagent**

**Let your agent run the eBay reselling business.** ONE API for the full reseller cycle — discovery, evaluation, buying, listing, fulfillment, and finance — across marketplaces. Today: eBay (REST mirror + scrape fallback). Soon: Amazon, Mercari, Poshmark.

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Rank deals matching a query — server runs the full pipeline.
const { deals } = await client.discover.deals({
  q: "canon ef 50mm 1.8",
  opts: { minNetCents: 2000 },
});

deals.forEach((d) => console.log(d.evaluation.expectedNetCents, d.evaluation.rating, d.item.title));
```

> **Get a free key** (500 credits one-time, no card) at [flipagent.dev/signup](https://flipagent.dev/signup). Hop into [Discord](https://discord.gg/PUyURdjMtv) for questions, bugs, and build talk.

---

## Why flipagent?

- **Composite endpoints, not glue code.** `evaluate_listing` and `discover_deals` fetch the item, search sold + active in parallel, run an LLM same-product filter, and score in a single call.
- **Server-side scoring, one source of truth.** Median, IQR cleaning, brand-typo signals, landed cost — every client (TS / MCP / future Python / Go) gets the same math from `services/quant/`.
- **eBay REST surface mirrored 1:1.** `/v1/buy/*`, `/v1/sell/*`, `/v1/commerce/*`, `/v1/post-order/*` map verbatim onto eBay's paths so agents can read eBay docs and call our routes one-to-one.
- **Bridge for the human-only steps.** A Chrome extension runs sensitive flows (BIN checkout, forwarder dashboards) inside *your* browser with *your* logins — flipagent never holds third-party credentials.
- **Anti-thundering-herd cache.** 60min active / 12h sold / 4h detail. Short TTLs, original `ebay.com/itm/...` URL on every cached row.
- **Agent-ready out of the box.** One-command MCP setup for Claude Desktop, Cursor, Cline, Zed, Continue, Windsurf.
- **Open source.** Types, scraper, SDK, MCP, CLI, and extension all MIT. The hosted backend is FSL-1.1-ALv2 (source-available, converts to Apache 2.0 in 2 years).

---

## Feature Overview

**Core endpoints**

| Feature | Description |
|---|---|
| [**Listings**](#listings) | Search active eBay listings (REST or scrape, server picks). |
| [**Sold**](#sold) | Search sold comps (last 90d). |
| [**Evaluate**](#evaluate) | Score one listing — composite item + sold + active + LLM filter. |
| [**Discover**](#discover) | Rank deals for a query. Returns evaluations with `expectedNetCents` + rating. |

**More**

| Feature | Description |
|---|---|
| [**Ship**](#ship) | Forwarder + carrier quotes. Math runs server-side in cents. |
| [**Buy Order**](#buy-order) | `/v1/buy/order/*` — REST passthrough or bridge transport. |
| [**Inventory / Fulfillment / Finance**](#sell-side) | Sell-side eBay mirrors after `/v1/connect/ebay`. |
| [**Forwarder**](#forwarder) | Pull inbound packages from Planet Express via the bridge. |
| [**Expenses**](#expenses) | P&L ledger — record purchases, get monthly summaries. |

---

## Quick Start

Sign up at [flipagent.dev/signup](https://flipagent.dev/signup) — 500 credits, no card. Try the [playground](https://flipagent.dev/playground).

### Listings

Search active eBay listings.

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });
const { itemSummaries } = await client.listings.search({ q: "canon ef 50mm 1.8", limit: 50 });
```

<details>
<summary><b>cURL / MCP</b></summary>

**cURL**
```bash
curl -X GET 'https://api.flipagent.dev/v1/buy/browse/item_summary/search?q=canon%20ef%2050mm%201.8&limit=50' \
  -H 'X-API-Key: fa_free_xxx'
```

**MCP** (after setup below)
```
ebay_search { "q": "canon ef 50mm 1.8", "limit": 50 }
```
</details>

### Sold

Search sold comps from the last 90 days.

```ts
const { itemSales } = await client.sold.search({ q: "canon ef 50mm 1.8", limit: 50 });
```

### Evaluate

Score one listing — composite call. Server fetches the item, runs sold + active in parallel, applies an LLM same-product filter, returns rating + expected net cents.

```ts
const { evaluation } = await client.evaluate.listing({ itemId: "v1|123456789|0" });
//   evaluation.expectedNetCents, evaluation.rating, evaluation.signals, ...
```

### Discover

Rank deals for a query.

```ts
const { deals } = await client.discover.deals({
  q: "canon ef 50mm 1.8",
  opts: { minNetCents: 2000 },
});
```

### Ship

Forwarder + carrier quote. Math runs in `services/forwarder/`.

```ts
const quote = await client.ship.quote({
  item: { weightG: 250, lengthCm: 12, widthCm: 8, heightCm: 8 },
  forwarder: { destState: "WA" },
});
```

---

## Power Your Agent

### MCP — Claude Desktop, Cursor, Cline, Zed, Continue, Windsurf

```jsonc
{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": { "FLIPAGENT_API_KEY": "fa_free_xxx" }
    }
  }
}
```

Or one-command setup that detects your installed clients:

```bash
npx -y flipagent-cli init --mcp
```

Your agent gets 30 tools across search, sold, evaluate, discover, buy, list, ship, and expenses.

`evaluate_listing` and `discover_deals` are **composite** — server-side they fetch the item, search sold + active in parallel, run an LLM same-product filter (Anthropic / OpenAI / Google), and score in a single call. Set one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` on the API server to enable; without a key the composite endpoints fall back to the unfiltered sold + active pools (looser, evaluations still run).

### SDK

```bash
npm install @flipagent/sdk
```

One client, every namespace under `/v1/*`. Auth is one header.

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

await client.listings.search({ q: "...", limit: 50 });          // active listings
await client.sold.search({ q: "...", limit: 50 });              // sold listings (last 90d)
await client.evaluate.listing({ itemId });                      // score one listing (composite)
await client.discover.deals({ q, opts });                       // rank deals for a query (composite)
await client.ship.quote({ item, forwarder: { destState, weightG } });
```

Sell-side namespaces (`inventory`, `fulfillment`, `finance`, `markets`) require the user to authorize their eBay account first via `/v1/connect/ebay`.

---

## More Endpoints

### Buy Order

`/v1/buy/order/*` is the single Buy Order surface with two **first-class** transports — `rest` and `bridge`. Both produce the same eBay-shape `CheckoutSession` / `EbayPurchaseOrder` response.

- **REST transport** — direct passthrough. Requires `EBAY_ORDER_API_APPROVED=1` and the api key's eBay OAuth binding.
- **Bridge transport** — runs the BIN flow inside *your* logged-in Chrome via the extension. The agent never auto-clicks BIN or Confirm-and-pay; every click is yours, because [eBay's robots.txt](https://www.ebay.com/robots.txt) requires checkout to be human-driven. The agent's value is BEFORE the click (find / evaluate / queue) and AFTER (record / reconcile / P&L), not the click itself.

The 2-stage flow (`initiate` → `place_order`) is fully implemented in both transports. Multi-stage update endpoints (`shipping_address`, `payment_instrument`, `coupon`) only work in REST — bridge uses the buyer's stored eBay defaults and returns 412 with a clear pointer to switch transport.

### Sell-side

After [`/v1/connect/ebay`](https://docs.flipagent.dev/connect-ebay) authorizes the user's eBay account:

```ts
await client.inventory.createOrReplaceItem({ sku, ... });
await client.fulfillment.getOrders({ filter });
await client.finance.getPayouts({ filter });
```

### Forwarder

Bridge-driven. Pulls inbound package status from forwarder dashboards (Planet Express today) that have no public API.

```ts
await client.forwarder.planetExpress.packages();
```

### Expenses

P&L ledger — record purchases, COGS, fees; get monthly summaries.

```ts
await client.expenses.record({ kind: "purchase", amountCents: 4500, sku });
await client.expenses.summary({ month: "2026-04" });
```

---

## What's Inside

```
packages/
├── types/         @flipagent/types        — TypeBox schemas (/v1/* + eBay shapes)
├── ebay-scraper/  @flipagent/ebay-scraper — HTML parsers + plain-HTTP fetcher
├── sdk/           @flipagent/sdk          — typed client for api.flipagent.dev
├── mcp/           flipagent-mcp           — MCP server (Claude Desktop, Cursor, …)
├── cli/           flipagent-cli           — one-command MCP setup
├── extension/     @flipagent/extension    — Chrome extension (bridge executor)
└── api/           @flipagent/api          — Hono backend (FSL, source-available)
apps/docs/         @flipagent/docs         — flipagent.dev marketing + dashboard
```

## Architecture

```
   AI client (Claude/Cursor) ──► flipagent-mcp ──┐
                                                  │
   TS / Node app  ────────► @flipagent/sdk ───────┤  HTTPS
                                                  │
                                                  ▼
                                         api.flipagent.dev
                                                  │
                                                  ├── Postgres  (cache + auth + usage)
                                                  ├── services/quant    (deal-finding math)
                                                  └── adapters/ebay → managed scraper → ebay.com
```

What the hosted service does for you:

- **Server-side scoring** — median, IQR cleaning, brand-typo signals, landed cost. One source of truth, every client (TS/Python/Rust/Go/MCP) gets the same math.
- **Response cache** — 60min active / 12h sold / 4h detail. Anti-thundering-herd, not archival.
- **Managed scraping** — outbound traffic delegated to a managed Web Scraper API. No UA pool / fingerprint spoofing in our code.
- **Auth, metering, billing, webhooks** — one API key gets you all of it.

## Bridge (local executor)

Some endpoints can't run on flipagent's servers — they need a logged-in browser session we don't have, or they hit surfaces with no public API at all. The **bridge** is the protocol we use for these. The hosted API queues a job; your extension polls it; the work runs locally in your browser; the result streams back. Same `/v1/*` request and response shape as any other call.

The executor is [`@flipagent/extension`](packages/extension) — a Chrome MV3 extension. It runs entirely in *your* browser, on *your* tabs, with *your* cookies and *your* logins. flipagent never holds the third-party credentials it touches and never proxies checkouts or session traffic. There is no UA pool or fingerprint spoofing in our code path either — it's just your real Chrome.

The bridge protocol itself lives at `/v1/bridge/*` in [`@flipagent/api`](packages/api) (poll, result, login-status, pair) — you don't usually call it directly; the extension does. Whether bridge-driven automation against your own accounts is permitted in your context is your call; see the disclaimer below. Setup steps are in the [extension README](packages/extension/README.md).

---

## Self-host

The full backend (`packages/api`) is source-available under [FSL-1.1-ALv2](packages/api/LICENSE).

```bash
git clone https://github.com/flipagent/flipagent && cd flipagent
docker compose up                                                    # postgres + api on :4000
docker compose exec api node packages/api/dist/scripts/issue-key.js you@example.com
```

Migrations run on boot. Scraper / Stripe / OAuth credentials are optional — drop them in `packages/api/.env` (copy from `.env.example`) when you want them. See [`packages/api/README.md`](packages/api/README.md) for production setup.

---

## Resources

- [Documentation](https://flipagent.dev/docs)
- [API Reference](https://flipagent.dev/docs/api)
- [Playground](https://flipagent.dev/playground)
- [Changelog](https://flipagent.dev/changelog)

---

## Disclaimer

flipagent is an **experimental research project**. **Not affiliated with, endorsed by, or sponsored by eBay Inc.** The hosted endpoint at `api.flipagent.dev` may be unavailable, rate-limited, or removed without notice.

**eBay restrictions, effective 2026-02-20.** eBay's [updated User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259) prohibits robots, scrapers, LLM-driven bots, and end-to-end automated ordering against eBay's services without express permission from eBay. The eBay [API License Agreement](https://developer.ebay.com/join/api-license-agreement) further restricts using eBay data to train AI/LLM models and transferring it to third parties.

The MCP server, the `/buy/browse/*` + `/buy/marketplace_insights/*` scrape paths, and `/buy/order/*` flows are likely subject to these restrictions when run against production eBay without permission. Sandbox use, local research, and the pure-function math under `packages/api/src/services/{quant,forwarder}/` are not affected.

**Your responsibility.** If you use this code or the hosted API, you bear sole responsibility for whether your use case is permitted, for securing your credentials, for the behavior of any agent built on top, and for any account action or legal consequence. The authors accept no liability.

---

## License

| package | license |
|---|---|
| `types`, `ebay-scraper`, `sdk`, `mcp`, `cli` | **MIT** — published to npm |
| `extension` | **MIT** — installed unpacked from this repo (not published) |
| `api` | **FSL-1.1-ALv2** — source-available, converts to Apache 2.0 in 2 years |
| `apps/docs` | **All Rights Reserved** — readable for transparency; no redistribution |

See each `LICENSE` file for full text.

<p align="right" style="font-size: 14px; color: #555; margin-top: 20px;">
  <a href="#readme-top" style="text-decoration: none; font-weight: bold;">
    ↑ Back to Top ↑
  </a>
</p>
