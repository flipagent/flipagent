# flipagent

ONE API for online reselling. Search listings, evaluate deals, place orders, list inventory, ship via forwarder, track payouts — all through `api.flipagent.dev`. Today: eBay (REST mirror + scrape fallback). Soon: Amazon, Mercari, Poshmark.

```jsonc
// 30-second Claude Desktop setup
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

Get a free key (100 calls/mo, no card) at [flipagent.dev/signup](https://flipagent.dev/signup).

> **Status: experimental research project.** eBay's User Agreement update effective 2026-02-20 restricts AI agent and scraper access to its services. Read the [Disclaimer](#disclaimer) before using or deploying.

## Repository layout

```
packages/
├── types/          @flipagent/types        MIT  — TypeBox schemas for /v1/* (root) + eBay shapes (./ebay subpath)
├── ebay-scraper/   @flipagent/ebay-scraper MIT  — eBay HTML parsers + plain-HTTP fetcher
├── sdk/            @flipagent/sdk          MIT  — typed client for api.flipagent.dev
├── mcp/            flipagent-mcp           MIT  — MCP server (Claude/Cursor/etc.)
├── cli/            flipagent-cli           MIT  — one-command MCP setup (`npx -y flipagent-cli`)
└── api/            @flipagent/api          FSL-1.1-ALv2 — backend, source-available (not published to npm)
apps/
└── docs/           @flipagent/docs         proprietary — flipagent.dev site (Astro)
```

## Local development

```bash
npm install
docker compose up -d postgres
cp packages/api/.env.example packages/api/.env
# fill in SCRAPER_API_USERNAME / SCRAPER_API_PASSWORD (Oxylabs Web Scraper API) and Stripe keys (optional)
npm run --workspace @flipagent/api db:migrate
npm run --workspace @flipagent/api dev
# issue a bootstrap key (self-host, no GitHub OAuth needed)
npm run --workspace @flipagent/api issue-key -- you@example.com
```

The hosted dashboard at flipagent.dev issues keys via `POST /v1/me/keys`
(session-auth, after sign-in). Self-hosters who'd rather skip Better-Auth
use the `issue-key` script above. See [`docs/self-host`](https://flipagent.dev/docs/self-host/).

To also run the Astro dashboard locally pointed at your api:

```bash
PUBLIC_API_BASE_URL=http://localhost:4000 \
  npm run --workspace @flipagent/docs dev
```

## Architecture

```
   AI client (Claude/Cursor) ──► flipagent-mcp ──┐
                                                  │
   TS / Node app ──► @flipagent/sdk ──────────────┤  HTTPS
                                                  │
                                                  ▼
                                           api.flipagent.dev
                                                  │  (= @flipagent/api)
                                                  ├── Postgres (cache + auth + usage)
                                                  ├── services/scoring (deal-finding math, server-side)
                                                  └── adapters/ebay → Oxylabs proxy → ebay.com
```

All endpoints live under `/v1/{resource}/*` — marketplace-agnostic. Today eBay-shape responses; future Amazon/Mercari adapters reuse the same paths via a `marketplace` parameter.

- **Marketplace passthrough**: `/v1/listings`, `/v1/sold`, `/v1/orders`, `/v1/inventory`, `/v1/fulfillment`, `/v1/finance`, `/v1/markets`.
- **flipagent value-add** (server-side, marketplace-agnostic):
  - `/v1/evaluate`, `/v1/evaluate/signals` — single-listing judgment (Decisions).
  - `/v1/discover` — rank deals across a search (Overnight).
  - `/v1/ship/quote`, `/v1/ship/providers` — forwarder quote + catalog (Operations).
- **flipagent management**: `/v1/keys`, `/v1/billing`, `/v1/connect`, `/v1/me`, `/v1/takedown`.

## Commands

| Command | What |
|---|---|
| `npm install` | Bootstrap workspaces |
| `npm run typecheck` | Full-repo `tsc --noEmit` |
| `npm run check` | Biome + typecheck |
| `npm run build` | Composite build of all packages |
| `npm test` | Run vitest in each workspace |
| `npm run dev` | Watch-mode all build-needing packages |

## Deploy targets

- `packages/api` → **Azure Container Apps** + **Postgres Flexible Server**.
  Terraform module in `infra/azure/`. First-time:
  `cd infra/azure && terraform init && terraform apply`. Then GitHub
  Actions (`.github/workflows/deploy-api.yml`) builds + pushes via
  `az acr build` and rolls the revision on every push to `main`.
- `apps/docs` → **Cloudflare Pages**. `.github/workflows/deploy-docs.yml`
  builds + deploys via `wrangler-action`.
- OSS packages → **npm publish via Changesets** (`.github/workflows/release.yml`).

## Disclaimer

flipagent is an **experimental research project**. It is **not affiliated with, endorsed by, or sponsored by eBay Inc.** No warranty is provided for fitness, reliability, or continued availability. The hosted endpoint at `api.flipagent.dev` may be unavailable, rate-limited, or removed at any time without notice.

### eBay restrictions on automated access

Effective **2026-02-20**, eBay's [User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259) prohibits

> any robot, spider, scraper, data mining tools, data gathering and extraction tools, or other automated means (including, without limitation buy-for-me agents, LLM-driven bots, or any end-to-end flow that attempts to place orders without human review) to access our Services for any purpose, except with the prior express permission of eBay.

Additionally, the eBay [API License Agreement](https://developer.ebay.com/join/api-license-agreement) (updated 2025-06-24) prohibits using eBay data to train, develop, or improve AI/LLM models, and restricts transferring eBay data to third parties.

The MCP server (`flipagent-mcp`), the `/buy/browse/*` and `/buy/marketplace_insights/*` scrape paths, and the `/buy/order/*` flow are likely subject to these restrictions when run against production eBay services without express permission from eBay. Sandbox use, local research, and the pure-function math under `packages/api/src/services/{scoring,quant,forwarder}/` are not affected.

### Your responsibility

If you use this code or the hosted API, you bear sole responsibility for:

- Whether your use case is permitted under eBay's User Agreement and API License Agreement
- Securing eBay Developer credentials and flipagent API keys
- The behavior of any AI agent or automation built on top of this software
- Any account suspension, termination, fees, or legal action that may result

The authors and maintainers accept no liability for damages, losses, account actions, or service disruptions arising from use of this software.

## License

- `packages/types`, `packages/ebay-scraper`, `packages/sdk`, `packages/mcp`, `packages/cli` — **MIT**, published to npm
- `packages/api` — **FSL-1.1-ALv2** (Functional Source License with Apache 2.0 future grant). Source-available; converts to Apache 2.0 two years after each release. Not published to npm
- `apps/docs` — **All rights reserved** (proprietary marketing site). Source visible for transparency; redistribution / rebrand not permitted

See each `LICENSE` file for the full text.
