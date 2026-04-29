# flipagent

### Let your agent run the eBay reselling business.

It sources, lists, and ships every order while you sleep.

[![License: MIT / FSL](https://img.shields.io/badge/license-MIT%20%2F%20FSL-blue.svg)](#license) [![Stars](https://img.shields.io/github/stars/flipagent/flipagent?style=social)](https://github.com/flipagent/flipagent) [![Docs](https://img.shields.io/badge/docs-flipagent.dev-black.svg)](https://flipagent.dev/docs)

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Search active listings, then rank the top deals by expected net profit.
const results = await client.listings.search({ q: "canon ef 50mm 1.8", limit: 50 });
const { deals } = await client.discover.deals({ results, opts: { minNetCents: 2000 } });

deals.forEach((d) => console.log(d.netCents, d.score, d.item.title));
```

> **Get a free key** (100 calls/month, no card) at [flipagent.dev/signup](https://flipagent.dev/signup).

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

Your agent gets 18 tools: search, sold-comps, evaluate, discover, buy, list, ship.

### As a typed SDK

```bash
npm install @flipagent/sdk
```

One client, every namespace under `/v1/*`. Auth is one header.

```ts
import { createFlipagentClient } from "@flipagent/sdk";
const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

await client.listings.search({ q: "...", limit: 50 });          // discovery
await client.sold.search({ q: "...", limit: 50 });              // 90-day comps
await client.evaluate.listing({ item, opts: { comps } });       // single-listing verdict
await client.discover.deals({ results, opts });                 // rank a search
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
                                                  ├── services/scoring  (deal-finding math)
                                                  └── adapters/ebay → managed scraper → ebay.com
```

What the hosted service does for you:

- **Server-side scoring** — median, IQR cleaning, brand-typo signals, landed cost. One source of truth, every client (TS/Python/Rust/Go/MCP) gets the same math.
- **Response cache** — 60min active / 12h sold / 4h detail. Anti-thundering-herd, not archival.
- **Managed scraping** — outbound traffic delegated to a managed Web Scraper API. No UA pool / fingerprint spoofing in our code.
- **Auth, metering, billing, webhooks** — one API key gets you all of it.

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

The MCP server, the `/buy/browse/*` + `/buy/marketplace_insights/*` scrape paths, and `/buy/order/*` flows are likely subject to these restrictions when run against production eBay without permission. Sandbox use, local research, and the pure-function math under `packages/api/src/services/{scoring,quant,forwarder}/` are not affected.

**Your responsibility.** If you use this code or the hosted API, you bear sole responsibility for whether your use case is permitted, for securing your credentials, for the behavior of any agent built on top, and for any account action or legal consequence. The authors accept no liability.

## License

| package | license |
|---|---|
| `types`, `ebay-scraper`, `sdk`, `mcp`, `cli` | **MIT** — published to npm |
| `api` | **FSL-1.1-ALv2** — source-available, converts to Apache 2.0 in 2 years |
| `apps/docs` | **All Rights Reserved** — readable for transparency; no redistribution |

See each `LICENSE` file for full text.
