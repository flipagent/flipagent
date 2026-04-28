# flipagent

ONE API for online reselling. The hosted service at `api.flipagent.dev`
gives AI agents and apps a unified surface for the full reseller cycle
(discovery → evaluation → buying → listing → fulfillment → finance)
across marketplaces. Today: eBay (REST mirror + scrape fallback). Soon:
Amazon, Mercari, Poshmark.

The whole API server is OSS (recall.ai-style: open backend, hosted
operations as the moat). Detection-evasion is delegated to a managed
scraping vendor (today: Oxylabs Web Scraper API) — flipagent's own code
path is a normal HTTPS client, no UA rotation or fingerprint spoofing.

## Workspaces

| Path | Name | License | Role |
|---|---|---|---|
| `packages/types` | `@flipagent/types` | MIT | TypeBox schemas for flipagent's own `/v1/*` — `evaluate`, `discover`, `ship` (intelligence layer) plus errors, tier, billing, keys, takedown, health |
| `packages/types/ebay` | `@flipagent/types/ebay` | MIT | TypeBox schemas mirroring eBay REST shapes — `/buy` (Browse + Marketplace Insights) and `/sell` (Inventory, Fulfillment) subpaths |
| `packages/ebay-scraper` | `@flipagent/ebay-scraper` | MIT | eBay HTML parsers + plain-HTTP fetcher (BYO proxy) |
| `packages/sdk` | `@flipagent/sdk` | MIT | Typed client. Marketplace passthrough namespaces (`listings`, `sold`, `orders`, `inventory`, `fulfillment`, `finance`, `markets`) plus flipagent intelligence (`research`, `match`, `evaluate`, `discover`, `ship`, `draft`, `reprice`, `expenses`) and ops (`webhooks`, `capabilities`). |
| `packages/mcp` | `flipagent-mcp` | MIT | MCP server — exposes eBay tools + deal-finding tools to Claude Desktop / Cursor / Cline. |
| `packages/cli` | `flipagent-cli` | MIT | One-command MCP setup. Detects Claude Desktop / Cursor and writes the `flipagent` server entry. `npx -y flipagent-cli init --mcp --keys`. |
| `packages/api` | `@flipagent/api` | FSL-1.1-ALv2 (private — not published, source on GitHub; converts to Apache 2.0 two years after each release) | Hono backend: unified API surface (eBay-compat + `/v1/*`), scraping, scoring, auth, billing. |
| `apps/docs` | `@flipagent/docs` | proprietary (All Rights Reserved) | flipagent.dev marketing + dashboard site (Astro static). Source visible for transparency; redistribution / rebrand not permitted. |

## Dependency direction

```
   @flipagent/types ──┐
                      ├──►  @flipagent/sdk  ──►  flipagent-mcp  (npm)
                      │            │
                      │            │ HTTPS
                      │            ▼
                      │     api.flipagent.dev
                      │            │  (= @flipagent/api)
                      │            │
                      ├──►  @flipagent/api  ──►  Postgres
                      │     (Hono backend)       Oxylabs Web Scraper API
   @flipagent/ebay-scraper ─────►  │              eBay / Amazon / Mercari (future)
                                   │
                                   └──►  services/{scoring,quant,forwarder} (server-side math)
```

`flipagent-mcp` calls flipagent's hosted API through `@flipagent/sdk`.
Math (median, margin, scoring, recipes) runs **server-side** in
`packages/api/src/services/scoring/` so all SDK clients in any language
get the same scoring without re-implementing it.

## Structural rules

- **Marketplace-agnostic surface.** Endpoints live under `/v1/{resource}/*`
  in two layers: **marketplace mirror** (`/v1/listings`, `/v1/sold`,
  `/v1/orders`, `/v1/inventory`, `/v1/fulfillment`, `/v1/finance`,
  `/v1/markets`) and **flipagent intelligence** (`/v1/research`,
  `/v1/match`, `/v1/evaluate`, `/v1/discover`, `/v1/ship`, `/v1/draft`,
  `/v1/reprice`, `/v1/expenses`), plus account/ops
  (`/v1/{keys,billing,connect,me,takedown,capabilities,health}`) and
  agent plumbing (`/v1/bridge` for the extension order executor,
  `/v1/browser` for browser-agent integration, `/v1/notifications` for
  webhook subscriptions, `/v1/webhooks` for eBay outbound dispatch).
  `/v1/orders` is bridge-driven and preempts the eBay Order API
  passthrough at the same paths (which 501s until eBay grants tenant
  approval). New marketplaces (Amazon, Mercari, …) reuse the mirror
  paths via a `marketplace` parameter rather than path prefixes.
  Internally, the passthrough layer maps `/v1/{inventory,fulfillment,...}`
  to eBay's verbose REST paths (`/sell/inventory/v1/...`) when calling
  `api.ebay.com` — see `packages/api/src/proxy/ebay-passthrough.ts`
  PATH_MAP.
- **OSS code never imports `apps/docs/*`.** Docs site is closed; never
  reach into it from packages.
- **Scraping is OSS, the vendor creds are env.** `@flipagent/ebay-scraper`
  ships pure parsers. The fetch path (response cache, takedown blocklist,
  vendor dispatcher) lives in `packages/api/src/proxy/` and is OSS too.
  Detection-evasion (residential rotation, anti-bot, JS rendering) is
  delegated to a managed Web Scraper API — flipagent does not ship its
  own UA pool or fingerprint spoofing. The vendor is selected via
  `SCRAPER_API_VENDOR` (today only `oxylabs` is wired) with credentials
  in `SCRAPER_API_USERNAME` / `SCRAPER_API_PASSWORD`. Adding a vendor =
  drop an adapter at `packages/api/src/proxy/scraper-api/<vendor>.ts`
  plus a case in the dispatcher.
- **SDK is a hand-rolled thin client.** `createFlipagentClient` returns
  one client with namespaces matching the `/v1/*` surface. Three groups:
  marketplace passthrough (`listings`, `sold`, `orders`, `inventory`,
  `fulfillment`, `finance`, `markets`), flipagent intelligence
  (`research`, `match`, `evaluate`, `discover`, `ship`, `draft`,
  `reprice`, `expenses`), and ops (`webhooks`, `capabilities`). No
  vendored eBay client in the user-facing path — the SDK speaks HTTPS
  to `api.flipagent.dev` directly. New endpoints get a typed namespace
  on the SDK; the underlying `client.http.{get,post,...}` is the escape
  hatch.
- **Cents in code, dollar strings on the wire.** Internal Listing /
  margin / scoring use cents-denominated integers. eBay's API uses
  string dollars on the wire; convert at the API boundary
  (`packages/api/src/proxy/scrape.ts`).
- **TypeBox for schemas.** Hono routes validate request bodies via
  `Value.Errors(Schema, body)`. Zod is banned in agent/tool surfaces.
- **Auth is X-API-Key or Authorization: Bearer.** Plaintext shown once
  at creation; only the sha256 hash persists. Tier limits enforced per
  calendar month (UTC) via `usage_events` count.

## Environment

`packages/api/.env.example` is the source of truth. Required:
`DATABASE_URL`. Recommended for any meaningful scrape volume:
`SCRAPER_API_VENDOR` (default `oxylabs`) plus `SCRAPER_API_USERNAME` /
`SCRAPER_API_PASSWORD`. Without those the scrape paths still work for
small-volume use but you'll hit eBay's bot wall fast. Stripe billing is
opt-in: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_HOBBY`, `STRIPE_PRICE_PRO` together or not at all —
`/v1/billing/*` returns 503 when any are missing.

eBay OAuth passthrough is opt-in too: set `EBAY_CLIENT_ID`,
`EBAY_CLIENT_SECRET`, `EBAY_RU_NAME` together or not at all —
`/v1/connect/ebay/*`, every `/sell/*`, `/buy/order/v1/*`, and
`/commerce/*` route returns 503 when any are missing. Default
`EBAY_BASE_URL=https://api.ebay.com` (swap to sandbox by setting
`EBAY_BASE_URL` + `EBAY_AUTH_URL` to `*.sandbox.ebay.com`). Order API
is Limited Release — `/buy/order/v1/*` stays at 501 until
`EBAY_ORDER_API_APPROVED=1` is set after eBay grants tenant approval.

## Code conventions

- TypeScript strict, `"type": "module"`, `Node16` moduleResolution,
  ES2022 target.
- Tab indent, width 3, line width 120 (Biome 2.3.x).
- No `any` unless commented with reason.
- Top-level `import` only; no inline dynamic imports in source.
- Each package: `src/`, optional `test/`, `package.json`,
  `tsconfig.build.json`, `dist/` (gitignored).

## Commands

- `npm install` — bootstrap all workspaces.
- `npm run typecheck` — full-repo `tsc --noEmit`.
- `npm run check` — biome + typecheck.
- `npm run build` — composite build of types → ebay-scraper → sdk →
  api → mcp → cli → docs (in dependency order).
- `npm test` — vitest in each workspace that has tests.
- `docker compose up -d postgres` — local Postgres on `localhost:55432`.
- `cd packages/api && npm run db:migrate` — apply drizzle migrations.

## ToS hygiene (eBay)

- Never redistribute raw listing content (titles, descriptions, photos,
  seller details) divorced from `itemWebUrl`. Cached responses always
  carry the original `ebay.com/itm/...` URL.
- Cache TTL is short (60 min active, 12h sold, 4h detail). The cache
  is anti-thundering-herd, not archival.
- `/v1/takedown` accepts seller opt-out. Approved takedowns flush the
  cache and blocklist the itemId. Doubles as our GDPR Art. 17 / CCPA
  delete-request channel — same pipe, three regulatory regimes.
- Outbound scrape traffic to ebay.com is delegated to the managed
  scraper vendor (`SCRAPER_API_VENDOR`), not issued from flipagent's
  own IPs — so we don't hammer ebay.com directly.

## Deploy

- `packages/api` → Azure Container Apps via `infra/azure/` Terraform.
  Container Registry pushes from `az acr build`; a system-assigned
  identity has `AcrPull`. Postgres Flexible Server is reachable via the
  "Allow Azure services" firewall rule. `MIGRATE_ON_BOOT=1` is set on
  the Container App env so drizzle migrations run before the api starts
  (idempotent; revisit if `min_replicas` ever exceeds 1).
- `apps/docs` → Cloudflare Pages. Static `dist/`.
- OSS packages → npm publish via Changesets. Workflow: `npx changeset`
  on a PR to declare what changed and at what bump (patch/minor/major)
  per package. On merge to `main`, `.github/workflows/release.yml`
  either opens a "Version Packages" PR (if changesets are pending) or
  publishes the bumped packages with npm provenance (if a previous
  Version PR was just merged). `NPM_TOKEN` secret must be set; private
  packages (`@flipagent/api`, `@flipagent/docs`) are skipped via
  `"private": true`.

## When extending

- New eBay endpoint → add a route under `packages/api/src/routes/ebay/`
  mounted at the appropriate `/v1/{resource}/*` path. If it talks to
  `api.ebay.com` via OAuth passthrough, add a PATH_MAP entry in
  `packages/api/src/proxy/ebay-passthrough.ts` so the new path
  translates to eBay's verbose REST path. Schema in
  `packages/types/src/ebay/{buy,sell}.ts`. SDK namespace method in
  the corresponding `packages/sdk/src/{listings,sold,orders,...}.ts`.
  MCP tool in `packages/mcp/src/tools/`.
- New flipagent-specific endpoint → put it under `/v1/`. Schema in
  `packages/types/src/` — `research.ts` / `evaluate.ts` / `discover.ts`
  / `ship.ts` / `draft.ts` / `reprice.ts` / `expenses.ts` for the
  intelligence layer, `flipagent.ts` for account/ops, or a new file
  matching the route namespace.
- New scoring algorithm → goes to `packages/api/src/services/scoring/`
  (or `quant/` for low-level stats, `forwarder/` for shipping rates).
  Pure functions, no I/O, cents-denominated. Add a vitest in
  `packages/api/test/services/`.
- New scraper helper → goes to `@flipagent/ebay-scraper` only if it's
  pure parsing. Anything that talks to a proxy or DB belongs in
  `packages/api/src/proxy/`.
- New marketplace adapter (Amazon, Mercari, etc.) → goes in
  `packages/api/src/adapters/<marketplace>/`. Register routes under
  the unified `/listings/*`, `/orders/*` etc. surface (not
  marketplace-specific paths).
