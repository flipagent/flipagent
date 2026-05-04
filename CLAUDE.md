# flipagent

The API to resell on eBay for AI agents. The hosted service at
`api.flipagent.dev` covers the full reseller cycle (search →
evaluation → buying → listing → fulfillment → finance) under one
key. Today: eBay (REST + Trading XML + scrape + bridge). Soon:
Amazon, Mercari, Poshmark.

The whole API server is OSS (recall.ai-style: open backend, hosted
operations as the moat). Page rendering for `EBAY_*_SOURCE=scrape` is
delegated to a managed Web Scraper API (today: Oxylabs) — we POST a
URL and they return rendered HTML on their infrastructure, under their
upstream-marketplace ToS. flipagent's own code path is a normal HTTPS
client; it does not implement UA rotation, browser fingerprinting, or
any other vendor-side concern.

## Workspaces

| Path | Name | License | Role |
|---|---|---|---|
| `packages/types` | `@flipagent/types` | MIT | TypeBox schemas for the flipagent-native `/v1/*` surface. One file per resource (`items`, `listings`, `purchases`, `sales`, `payouts`, `messages`, `offers`, `disputes`, `policies`, `evaluate`, `ship`, `expenses`, …). |
| `packages/types/ebay` | `@flipagent/types/ebay` | MIT | TypeBox schemas mirroring eBay's REST shapes (`buy`, `sell`, `commerce`). Used by the api internally for upstream wire shape, and by the Chrome extension + MCP mock for typing eBay-shape responses. |
| `packages/ebay-scraper` | `@flipagent/ebay-scraper` | MIT | eBay HTML parsers + a plain-HTTPS fetcher (`fetchHtml`, `fetchEbaySearch`, `fetchEbayItemDetail`) for BYO-proxy / standalone use. The hosted api still wraps them with its own managed-vendor dispatcher in `packages/api/src/services/ebay/scrape/` so production traffic flows through Oxylabs et al., but the package itself is fully usable on its own. |
| `packages/sdk` | `@flipagent/sdk` | MIT | Typed thin client for `api.flipagent.dev`. Namespaces match the route resources: `items`, `listings`, `purchases`, `sales`, `payouts`, `transactions`, `disputes`, `policies`, `categories`, `products`, `forwarder`, `evaluate`, `ship`, `expenses`, `webhooks`, `capabilities`. |
| `packages/mcp` | `flipagent-mcp` | MIT | MCP server — exposes flipagent tools (search, evaluate, buy, list, …) to Claude Desktop / Cursor / Cline. |
| `packages/cli` | `flipagent-cli` | MIT | One-command MCP setup. Detects Claude Desktop / Cursor and writes the `flipagent` server entry. `npx -y flipagent-cli init --mcp --keys`. |
| `packages/extension` | `@flipagent/extension` | MIT | Chrome extension — local executor for the bridge surfaces (`/v1/purchases`, `/v1/forwarder/*`, `/v1/browser/*`). Runs jobs inside the user's existing Chrome (their cookies, their marketplace logins). |
| `packages/api` | `@flipagent/api` | FSL-1.1-ALv2 (private — not published, source on GitHub; converts to Apache 2.0 two years after each release) | Hono backend: the unified `/v1/*` surface, scraping, scoring, auth, billing. |
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
                                   └──►  services/{quant,forwarder} (server-side math)
```

`flipagent-mcp` calls flipagent's hosted API through `@flipagent/sdk`.
Math (median, margin, scoring, recipes) runs **server-side** in
`packages/api/src/services/quant/` so all SDK clients in any language
get the same scoring without re-implementing it.

## Structural rules

- **Marketplace-agnostic, flipagent-native surface.** Endpoints live
  under `/v1/<resource>` only. Every route has a flipagent shape with
  cents-int Money, ISO timestamps, lowercase status enums, and a
  `marketplace` discriminator on every record. New marketplaces
  (Amazon, Mercari, …) reuse the same paths via the `marketplace`
  parameter rather than path prefixes.

  Resources, by group. Phase 1 = live mounts in `routes/v1/index.ts`;
  V2 = typed service + route wrappers ready, mount commented out until
  promoted (see the bottom block of `routes/v1/index.ts`).

  Phase 1 (live):
  - **Marketplace data (read)** — `/v1/{items,categories,products,media}`
  - **My side (write)** — `/v1/{listings,locations,purchases,bids,sales}`
  - **Money + comms + disputes** —
    `/v1/{payouts,transactions,transfers,messages,offers,feedback,disputes,policies,recommendations}`
  - **Intelligence** — `/v1/{evaluate,ship}`
  - **Storefront ops** — `/v1/{analytics,labels}`
  - **My eBay surfaces** — `/v1/me/seller`, `/v1/me/{selling,buying,programs,quota,…}`
  - **Account / ops** — `/v1/{forwarder,connect,me,keys,billing,health,capabilities,takedown,admin}`
  - **Agent (preview)** — `/v1/agent` (OpenAI Responses API, stateful threads + native MCP wiring)
  - **Agent plumbing** — `/v1/{bridge,browser,notifications,webhooks}`

  V2 (wrapped, not mounted): `charities, featured, listings/bulk,
  listing-groups, cart, edelivery, violations, marketplaces, expenses,
  trends, promotions, markdowns, ads, store, feeds, translate,
  watching, saved-searches, developer`. Re-enable by uncommenting
  the import + mount in `routes/v1/index.ts`.

  Operator routes (`requireAdmin` = session + `user.role==='admin'`):
  `/v1/admin/{users,grants,keys,stats}`. Bootstrap by adding emails
  to `ADMIN_EMAILS` env — Better-Auth's user-create hook +
  `requireSession` reconcile `user.role` on next visit. Admin tier /
  role / credit overrides never touch Stripe — they're operator
  actions independent of subscription state. Credit overrides go
  through the append-only `credit_grants` ledger (positive = bonus,
  negative = clawback, with optional `expiresAt`); `snapshotUsage`
  folds active grants into `creditsLimit`.

- **Provider / resource / route layering.** The eBay provider lives
  at `packages/api/src/services/ebay/{rest,scrape,bridge,trading}/`
  — one folder per transport, all eBay-specific code and only that.
  REST is split into two clients: `rest/user-client.ts` (`sellRequest`,
  user OAuth) and `rest/app-client.ts` (`appRequest`, app credential).
  Resource services at `services/<resource>/*` (items, listings,
  purchases, sales, money, marketing/{promotions,ads,markdowns,reports},
  …) are marketplace-agnostic business logic; transport-pluggable
  resources pick a transport via `services/shared/transport.ts`
  (`selectTransport` + `RESOURCE_TRANSPORTS` capability matrix) and
  dispatch into the eBay provider folders. Routes at `routes/v1/*`
  validate input via TypeBox, call the resource service, and render
  cache/source headers via `renderResultHeaders` from
  `services/shared/headers.ts`. Future Amazon / Mercari adapters
  drop in as `services/amazon/`, `services/mercari/` siblings of
  `services/ebay/`, with their own capability matrices.

- **One file per route resource.** `routes/v1/<resource>.ts` mounts
  on `/v1/<resource>`, one mount per prefix in `routes/v1/index.ts`.
  No grab-bag files (no `extras-*.ts`, no `marketing-*.ts`). Cross-prefix
  routes (e.g. `/policies/{id}/transfer` lives with `/policies` even
  though the underlying eBay endpoint is sell/account) are merged
  into the owning resource's file.

- **OSS code never imports `apps/docs/*`.** Docs site is closed; never
  reach into it from packages.

- **Scraping is OSS, the vendor creds are env.** `@flipagent/ebay-scraper`
  ships both the parsers and a plain-HTTPS fetcher (`fetchHtml`,
  `fetchEbaySearch`, `fetchEbayItemDetail`) so it works as a standalone
  package — BYO proxies, drop into your own pipeline, fine for
  low-volume / fixture / test work. The hosted api wraps the same
  parsers with its own managed-vendor dispatcher in
  `packages/api/src/services/ebay/scrape/`; the dispatcher is what runs
  in production so we don't pound ebay.com from our IPs. The shared
  response cache primitives sit in `services/shared/cache.ts`. The
  managed Web Scraper API takes a URL and returns rendered HTML —
  whatever rendering, IP routing, or JS execution the vendor performs
  is on their side, under their own upstream-marketplace ToS. flipagent
  does not ship a UA pool, browser fingerprinting, or any equivalent
  vendor-side logic of its own. The vendor is selected via
  `SCRAPER_API_VENDOR` (today only `oxylabs` is wired) with credentials
  in `SCRAPER_API_USERNAME` / `SCRAPER_API_PASSWORD`. Adding a vendor =
  drop an adapter at
  `packages/api/src/services/ebay/scrape/scraper-api/<vendor>.ts`
  plus a case in the dispatcher.

- **SDK is a hand-rolled thin client.** `createFlipagentClient` returns
  one client whose namespaces map one-to-one to the route resources
  above (`client.items` → `/v1/items`, `client.listings` → `/v1/listings`,
  `client.purchases` → `/v1/purchases`, `client.payouts` → `/v1/payouts`,
  …). No vendored eBay client in the user-facing path — the SDK speaks
  HTTPS to `api.flipagent.dev` directly. New endpoints get a typed
  namespace on the SDK; the underlying `client.http.{get,post,...}`
  is the escape hatch.

- **Cents in code, dollar strings on the wire.** Internal Listing /
  margin / scoring use cents-denominated integers. eBay's API uses
  string dollars on the wire; the shared converters live in
  `services/shared/money.ts` (`toCents`, `toDollarString`, `moneyFrom`,
  `moneyFromOrZero`). Apply at the resource-service boundary.

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
small-volume use but datacenter HTTP responses degrade quickly under
sustained load. Stripe billing is opt-in: set `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_HOBBY`, `STRIPE_PRICE_STANDARD`,
`STRIPE_PRICE_GROWTH` together or not at all — `/v1/billing/*`
returns 503 when any are missing.

eBay OAuth passthrough is opt-in too: set `EBAY_CLIENT_ID`,
`EBAY_CLIENT_SECRET`, `EBAY_RU_NAME` together or not at all —
`/v1/connect/ebay/*` and any sell-side route that needs user OAuth
(listings, sales, payouts, transactions, transfers, policies, …)
returns 503 when any are missing. Default
`EBAY_BASE_URL=https://api.ebay.com` (swap to sandbox by setting
`EBAY_BASE_URL` + `EBAY_AUTH_URL` to `*.sandbox.ebay.com`).

`/v1/purchases` is the single Buy Order surface with two **first-class**
transports — `rest` and `bridge`. Both produce the same flipagent
`Purchase` shape; neither is a "fallback" for the other.
`selectTransport` (in `services/shared/transport.ts`) picks one given
the capability matrix + per-call `?transport=` override + env flag
(`EBAY_ORDER_APPROVED`). REST requires the env flag + the api
key's eBay OAuth binding; bridge requires a paired Chrome extension.
The 2-stage flow (`initiate` → `place_order`) is fully implemented in
both transports. Multi-stage update endpoints (`shipping_address`,
`payment_instrument`, `coupon`) only work in REST transport — bridge
uses the buyer's stored eBay defaults so those return 412 with a
clear pointer to switch transport.

**Bridge-driven non-buy ops have their own surface, not a generic
`/v1/orders/*` queue.** Each source the bridge handles maps to a
typed public surface:

  - `/v1/purchases` — eBay buy (REST + bridge transports)
  - `/v1/forwarder/{provider}/*` — package forwarder ops (Planet
    Express today; used in both buy + sell flows so it sits at top
    level)
  - `/v1/browser/*` — synchronous DOM primitives (browser_op)
  - control / extension reload — internal admin only

`/v1/bridge/*` and `/v1/browser/*` are NOT the same thing — different
layers serving different audiences:

  - `/v1/bridge/*` = the wire protocol the Chrome extension uses to
    talk to flipagent (token issuance + longpoll + result reporting +
    login-status). Audience: the extension itself.
  - `/v1/browser/*`, `/v1/purchases`, `/v1/forwarder/*`, etc. =
    user-facing surfaces that internally queue work via the bridge.
    Audience: agents / SDK callers.

The shared bridge queue infra lives in `services/bridge-jobs.ts`.
Each public surface calls `createBridgeJob` with its own `source` value;
the bridge route maps source → task name via
`services/ebay/bridge/tasks.ts`.

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

- `packages/api` → **two Azure Container Apps from one image** via
  `infra/azure/` Terraform:
  - **`<prefix>-api`** runs `node dist/server.js` (HTTP only). HTTP
    scale rule, `min_replicas=1`. `MIGRATE_ON_BOOT=1` so drizzle
    migrations run before the api starts (idempotent; revisit if
    `min_replicas` ever exceeds 1).
  - **`<prefix>-worker`** runs `node dist/worker.js` (no HTTP).
    Claims `compute_jobs` (evaluate, discover) so CPU-bound pipelines
    never starve the api event loop. KEDA Postgres scaler reads queue
    depth (`compute_jobs WHERE status='queued' OR expired-lease`) and
    scales replicas 0→N. `min_replicas=0` so an idle deploy costs
    nothing. `MIGRATE_ON_BOOT=0` (api owns migration).

  Container Registry pushes from `az acr build`; a system-assigned
  identity has `AcrPull`. Postgres Flexible Server is reachable via
  the "Allow Azure services" firewall rule. The worker process model
  (lease + heartbeat + recovery sweep) is documented in
  `services/compute-jobs/queue.ts`.
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

- **New flipagent resource.**
  1. Add a TypeBox schema file at `packages/types/src/<resource>.ts`
     (request/response shapes + list query) and re-export from
     `packages/types/src/index.ts`.
  2. Add a service at `packages/api/src/services/<resource>/operations.ts`
     (pure logic; takes a context object with `apiKeyId` + optional
     `marketplace`, returns flipagent-shape objects). For
     transport-pluggable resources, call `selectTransport(...)` from
     `services/shared/transport.ts`.
  3. Add a route at `packages/api/src/routes/v1/<resource>.ts` that
     validates input via `tbBody` / `tbCoerce`, calls the service,
     and renders headers via `renderResultHeaders` when applicable.
     Mount it in `routes/v1/index.ts` exactly once.
  4. Add an SDK namespace at `packages/sdk/src/<resource>.ts` and
     wire it into `createFlipagentClient`.
  5. Add a vitest in `packages/api/test/services/<resource>/`.

- **eBay REST call.** Use the shared clients in
  `services/ebay/rest/`: `sellRequest` (user OAuth) for sell-side
  routes that act on the caller's eBay account, or `appRequest` (app
  credential) for public marketplace reads. Both throw `EbayApiError`
  on non-2xx so the route boundary maps both uniformly.

- **eBay Trading API call (XML/SOAP).** Add a service in
  `services/ebay/trading/` (use `client.ts` helpers `tradingCall`,
  `parseTrading`, `escapeXml`). Add a v1 route that wraps it as JSON;
  wrap the handler in `withTradingAuth(...)` from
  `middleware/with-trading-auth.ts` — it resolves user OAuth,
  surfaces 401 `ebay_account_not_connected`, maps `TradingApiError`
  uniformly. See `routes/v1/{messages,offers,feedback}.ts`.

- **eBay bridge task.** Add a constant to `BRIDGE_TASKS` in
  `services/ebay/bridge/tasks.ts`, declare bridge capability in
  `RESOURCE_TRANSPORTS`, and have the resource service queue the
  task through the existing bridge queue (`services/bridge-jobs.ts`).
  The Chrome extension picks it up via `/v1/bridge/poll`.

- **Service-result envelope (transport-pluggable resources).** When a
  resource has multiple transports (rest + scrape + bridge + trading),
  the service returns `FlipagentResult<T> = { body, source, fromCache,
  cachedAt? }` from `services/shared/result.ts`. `source` is one of
  `"rest" | "scrape" | "bridge" | "trading" | "llm"` — the data
  origin, never `"cache:..."` (cache hits flip `fromCache`). Routes
  call `renderResultHeaders(c, result)` to set `X-Flipagent-Source`
  + `X-Flipagent-From-Cache` + `X-Flipagent-Cached-At`. Wrap upstream
  calls in `withCache(args, fetcher)` from
  `services/shared/with-cache.ts` — one canonical cache-or-fetch
  flow with built-in upstream timeout.

- **New scoring algorithm** → goes to
  `packages/api/src/services/quant/` (low-level stats, scoring,
  margin) or `forwarder/` (shipping rates). Pure functions, no I/O,
  cents-denominated. Add a vitest in
  `packages/api/test/services/<area>/`.

- **New scraper helper** → parsers go to `@flipagent/ebay-scraper`
  (`src/parse-*.ts`); BYO-proxy fetch helpers can live there too
  (`src/fetch-*.ts`). Anything that talks to a managed-vendor scraper
  (Oxylabs et al.) or to the DB belongs in
  `packages/api/src/services/ebay/scrape/`.

- **New marketplace adapter (Amazon, Mercari, etc.)** → *future*;
  siblings of `services/ebay/`, e.g. `services/amazon/`,
  `services/mercari/`, with their own provider folders + capability
  matrix entries in `services/shared/transport.ts`. Existing routes
  pick the right provider via the `marketplace` parameter — no new
  path prefixes.
