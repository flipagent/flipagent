# flipagent

### Let your agent run the eBay reselling business.

It sources, lists, and ships every order while you sleep.

[![License: MIT / FSL](https://img.shields.io/badge/license-MIT%20%2F%20FSL-blue.svg)](#license) [![Stars](https://img.shields.io/github/stars/flipagent/flipagent?style=social)](https://github.com/flipagent/flipagent) [![Docs](https://img.shields.io/badge/docs-flipagent.dev-black.svg)](https://flipagent.dev/docs) [![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/PUyURdjMtv)

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

## Two ways to use it

### As an MCP server — Claude Desktop, Cursor, Cline, Zed, Continue, Windsurf

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

Your agent gets 30 tools: search, sold, evaluate, discover, buy, list, ship, expenses.

`evaluate_listing` and `discover_deals` are **composite** — server-side they fetch the item, search sold + active in parallel, run an LLM same-product filter (Anthropic / OpenAI / Google), and score in a single call. Set one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` on the API server to enable; without a key the composite endpoints fall back to the unfiltered sold + active pools (looser, evaluations still run).

### As a typed SDK

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

## What's inside

```
packages/
├── types/         @flipagent/types        — TypeBox schemas (/v1/* + eBay shapes)
├── ebay-scraper/  @flipagent/ebay-scraper — HTML parsers + plain-HTTP fetcher
├── sdk/           @flipagent/sdk          — typed client for api.flipagent.dev
├── mcp/           flipagent-mcp           — MCP server
├── cli/           flipagent-cli           — one-command MCP setup
├── extension/     @flipagent/extension    — Chrome extension (buy-flow executor for /v1/buy/order/*)
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

What it powers today:

- **`/v1/buy/order/*` — eBay buy ordering.** Watches the BIN flow on `ebay.com/itm/...` — validates price against the agent's cap, annotates the page with a "ready to buy" banner, and captures the eBay order id after *you* confirm. The extension never auto-clicks BIN or Confirm-and-pay; every click is yours, because [eBay's robots.txt](https://www.ebay.com/robots.txt) requires checkout to be human-driven. The agent's value is BEFORE the click (find / evaluate / queue) and AFTER (record / reconcile / P&L), not the click itself. Alternative: set `EBAY_ORDER_API_APPROVED=1` to switch the same routes to direct REST passthrough if you have eBay's Buy Order API approval.
- **`/v1/forwarder/{provider}/*` — package forwarder ops.** Pulls inbound package status from forwarder dashboards (Planet Express today) that have no public API.
- **`/v1/browser/*` — DOM primitives.** Synchronous `querySelectorAll`-style probe over the active tab. Mainly an escape hatch for agents and selector tuning during dev.

The bridge protocol itself lives at `/v1/bridge/*` in [`@flipagent/api`](packages/api) (poll, result, login-status, pair) — you don't usually call it directly; the extension does.

How we provide it: the extension is MIT-licensed and shipped as source in this repo. We do not (and cannot) auto-install it — you load the unpacked build into Chrome yourself, the same way you'd load any developer tool. Whether bridge-driven automation against your own accounts is permitted in your context is your call; see the disclaimer below. Setup steps are in the [extension README](packages/extension/README.md).

## Self-host

The full backend (`packages/api`) is source-available under [FSL-1.1-ALv2](packages/api/LICENSE).

```bash
git clone https://github.com/flipagent/flipagent && cd flipagent
docker compose up                                                    # postgres + api on :4000
docker compose exec api node packages/api/dist/scripts/issue-key.js you@example.com
```

Migrations run on boot. Scraper / Stripe / OAuth credentials are optional — drop them in `packages/api/.env` (copy from `.env.example`) when you want them. See [`packages/api/README.md`](packages/api/README.md) for production setup.

---

## Disclaimer

flipagent is an **experimental research project**. **Not affiliated with, endorsed by, or sponsored by eBay Inc.** The hosted endpoint at `api.flipagent.dev` may be unavailable, rate-limited, or removed without notice.

**eBay restrictions, effective 2026-02-20.** eBay's [updated User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259) prohibits robots, scrapers, LLM-driven bots, and end-to-end automated ordering against eBay's services without express permission from eBay. The eBay [API License Agreement](https://developer.ebay.com/join/api-license-agreement) further restricts using eBay data to train AI/LLM models and transferring it to third parties.

The MCP server, the `/buy/browse/*` + `/buy/marketplace_insights/*` scrape paths, and `/buy/order/*` flows are likely subject to these restrictions when run against production eBay without permission. Sandbox use, local research, and the pure-function math under `packages/api/src/services/{quant,forwarder}/` are not affected.

**Your responsibility.** If you use this code or the hosted API, you bear sole responsibility for whether your use case is permitted, for securing your credentials, for the behavior of any agent built on top, and for any account action or legal consequence. The authors accept no liability.

## License

| package | license |
|---|---|
| `types`, `ebay-scraper`, `sdk`, `mcp`, `cli` | **MIT** — published to npm |
| `extension` | **MIT** — installed unpacked from this repo (not published) |
| `api` | **FSL-1.1-ALv2** — source-available, converts to Apache 2.0 in 2 years |
| `apps/docs` | **All Rights Reserved** — readable for transparency; no redistribution |

See each `LICENSE` file for full text.
