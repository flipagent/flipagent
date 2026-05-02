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
    <a href="https://x.com/flipagent_dev">
      <img src="https://img.shields.io/badge/Follow%20%40flipagent__dev-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow @flipagent_dev">
    </a>
    <a href="https://flipagent.dev/signup">
      <img src="https://img.shields.io/badge/Get%20a%20free%20key-000000?style=for-the-badge&logoColor=white" alt="Get a free key">
    </a>
  </p>
</div>

---

# **flipagent**

**The API to resell on eBay for AI agents.** Search, evaluate, buy, list, fulfill, and reconcile — every step under `/v1/<resource>` with one API key. Today: eBay (REST + Trading XML + scrape + bridge). Soon: Amazon, Mercari, Poshmark.

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Score a single listing — server fetches item, runs sold + active in
// parallel, applies LLM same-product filter, returns rating + expected net.
const { evaluation } = await client.evaluate.listing({ itemId: "v1|123456789|0" });

console.log(evaluation.expectedNetCents, evaluation.rating, evaluation.signals);
```

> **Get a free key** (500 credits one-time, no card) at [flipagent.dev/signup](https://flipagent.dev/signup). Hop into [Discord](https://discord.gg/PUyURdjMtv) for questions, bugs, and build talk. Follow [@flipagent_dev](https://x.com/flipagent_dev) for ship notes.

---

## Why flipagent?

- **Composite endpoints, not glue code.** `flipagent_evaluate` fetches the item, searches sold + active in parallel, runs an LLM same-product filter, and scores in a single call.
- **Server-side scoring, one source of truth.** Median, IQR cleaning, brand-typo signals, landed cost — every client (TS / MCP / future Python / Go) gets the same math from `services/quant/`.
- **Marketplace-agnostic, flipagent-native surface.** One `/v1/<resource>` shape across eBay (today) and Amazon / Mercari (next). Cents-int Money, ISO timestamps, lowercase status enums — read once, port nowhere.
- **Bridge for the human-only steps.** A Chrome extension runs sensitive flows (BIN checkout, forwarder dashboards) inside *your* browser with *your* logins — flipagent never holds third-party credentials.
- **Anti-thundering-herd cache.** 60min active / 12h sold / 4h detail. Short TTLs, original `ebay.com/itm/...` URL on every cached row.
- **Agent-ready out of the box.** One-command MCP setup for Claude Desktop, Cursor, Cline, Zed, Continue, Windsurf.
- **Open source.** Types, scraper, SDK, MCP, CLI, and extension all MIT. The hosted backend is FSL-1.1-ALv2 (source-available, converts to Apache 2.0 in 2 years).

---

## Feature Overview

**Marketplace data (read)**

| Feature | Description |
|---|---|
| [**Items**](#items) | Search active or sold listings (cents-int Money, marketplace-tagged). |
| [**Categories**](#categories) | Taxonomy tree, suggestions, per-category aspects. |
| [**Products**](#products) | Universal product catalog (eBay EPID + scrape fallback). |

**My side (write)**

| Feature | Description |
|---|---|
| [**Listings**](#listings) | One-shot create / list / update / end. |
| [**Purchases**](#purchases) | Buy via REST passthrough or bridge transport. |
| [**Sales**](#sales) | List orders received, mark shipped, refund, cancel. |

**Intelligence (composite)**

| Feature | Description |
|---|---|
| [**Evaluate**](#evaluate) | Score one listing — composite item + sold + active + LLM filter. |
| [**Ship**](#ship) | Forwarder + carrier quote. Math runs server-side in cents. |
| [**Expenses**](#expenses) | P&L ledger — record purchases, COGS, fees; monthly summaries. |

**Money + ops**

| Feature | Description |
|---|---|
| [**Payouts / Transactions / Transfers**](#money) | Money in/out of your eBay seller balance — cents-int + lifecycle status. |
| [**Forwarder**](#forwarder) | Pull inbound packages from Planet Express via the bridge. |

---

## Quick Start

Sign up at [flipagent.dev/signup](https://flipagent.dev/signup) — 500 credits, no card. Try the [playground](https://flipagent.dev/playground).

### Items

Search active or sold marketplace listings.

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Active
const { items } = await client.items.search({ q: "canon ef 50mm 1.8", limit: 50 });

// Sold (last 90d)
const { items: sold } = await client.items.search({ q: "canon ef 50mm 1.8", status: "sold", limit: 50 });
```

<details>
<summary><b>cURL / MCP</b></summary>

**cURL**
```bash
curl -X GET 'https://api.flipagent.dev/v1/items/search?q=canon%20ef%2050mm%201.8&limit=50' \
  -H 'X-API-Key: fa_free_xxx'
```

**MCP** (after setup below)
```
flipagent_items_search { "q": "canon ef 50mm 1.8", "limit": 50 }
```
</details>

### Categories

```ts
const { categories } = await client.categories.list();                       // top-level
const { suggestions } = await client.categories.suggest({ title: "..." });   // title → category
const { aspects } = await client.categories.aspects(categoryId);             // required + recommended
```

### Products

```ts
const product = await client.products.get(epid);
const { products } = await client.products.search({ q: "...", gtin: "..." });
```

### Evaluate

Score one listing — composite call. Server fetches the item, runs sold + active in parallel, applies an LLM same-product filter, returns rating + expected net cents.

```ts
const { evaluation } = await client.evaluate.listing({ itemId: "v1|123456789|0" });
//   evaluation.expectedNetCents, evaluation.rating, evaluation.signals, ...
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

`flipagent_evaluate` is **composite** — server-side it fetches the item, searches sold + active in parallel, runs an LLM same-product filter (Anthropic / OpenAI / Google), and scores in a single call. Set one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` on the API server to enable; without a key the composite endpoints fall back to the unfiltered sold + active pools (looser, evaluations still run).

### SDK

```bash
npm install @flipagent/sdk
```

One client, every namespace under `/v1/*`. Auth is one header.

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Marketplace data (read)
await client.items.search({ q, status: "active", limit: 50 });
await client.items.get(itemId);

// My side (write)
await client.listings.create({ ... });
await client.purchases.create({ itemId, quantity: 1 });
await client.sales.list({ filter });

// Intelligence
await client.evaluate.listing({ itemId });
await client.ship.quote({ item, forwarder: { destState } });

// Money
await client.payouts.list();
await client.transactions.list();
```

Sell-side namespaces require the user to authorize their eBay account first via `/v1/connect/ebay`.

---

## More Endpoints

### Listings

```ts
await client.listings.create({ sku, title, price, condition, categoryId, images, policies, merchantLocationKey });
await client.listings.update(sku, { price, quantity });
await client.listings.end(sku);
await client.listings.relist(sku);
```

One-shot create compresses eBay's three-step Sell Inventory dance (PUT inventory_item → POST offer → POST publish) into a single call. Returns the live `Listing` with `status='active'` on success.

### Purchases

`/v1/purchases` is the single Buy Order surface with two **first-class** transports — `rest` and `bridge`. Both produce the same flipagent `Purchase` shape.

- **REST transport** — direct passthrough. Requires `EBAY_ORDER_API_APPROVED=1` and the api key's eBay OAuth binding.
- **Bridge transport** — runs the BIN flow inside *your* logged-in Chrome via the extension. The agent never auto-clicks BIN or Confirm-and-pay; every click is yours, because eBay's policy treats checkout as human-only. The agent's value is BEFORE the click (find / evaluate / queue) and AFTER (record / reconcile / P&L), not the click itself.

```ts
const order = await client.purchases.create({ itemId, quantity: 1 });
const status = await client.purchases.get(order.id);
await client.purchases.cancel(order.id);
```

### Sales

```ts
await client.sales.list({ filter });
await client.sales.markShipped(orderId, { trackingNumber, carrier });
await client.sales.refund(orderId, { reason });
await client.sales.cancel(orderId, { reason });
```

### Money

```ts
await client.payouts.list();
await client.payouts.summary({ from, to });
await client.transactions.list({ type: "sale" });
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
                                                  └── services/ebay/{rest,scrape,bridge,trading}
                                                           │
                                                           └── managed scraper → ebay.com
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

The MCP server, the scrape paths backing `/v1/items/*`, and `/v1/purchases` bridge flows are likely subject to these restrictions when run against production eBay without permission. Sandbox use, local research, and the pure-function math under `packages/api/src/services/{quant,forwarder}/` are not affected.

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
