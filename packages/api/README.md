# @flipagent/api

Hono backend that hosts `api.flipagent.dev`. ONE unified API for the
online reselling cycle — search, evaluation, forwarder quoting,
buying, listing, fulfillment, finance — all under `/v1/*`.

The product is the convenience: one flipagent API key handles auth,
metering, response cache, server-side scoring math, eBay OAuth
plumbing, and outbound calls (eBay REST, Trading XML, the
Chrome-extension bridge, or a managed Web Scraper API depending on
the resource).

Source-available under [FSL-1.1-ALv2](./LICENSE); marked
`private: true` in `package.json` so it isn't published to npm —
self-hosters clone this repo.

## Layout

```
packages/api/
├── src/
│   ├── server.ts             process entry, signal handlers
│   ├── app.ts                Hono app, middleware, route mounts
│   ├── config.ts             env validation (TypeBox)
│   ├── db/
│   │   ├── client.ts         postgres-js + drizzle handle
│   │   ├── schema.ts         api_keys, usage_events, listings_cache,
│   │   │                     proxy_response_cache, listing_observations,
│   │   │                     bridge_jobs, compute_jobs, takedown_requests, …
│   │   └── migrate.ts        `npm run db:migrate`
│   ├── auth/                 keys, bridge tokens, better-auth, key cipher
│   ├── billing/              Stripe Checkout + webhooks
│   ├── middleware/           auth (requireApiKey/Session/Admin),
│   │                         bridge-auth, with-trading-auth
│   ├── services/
│   │   ├── ebay/
│   │   │   ├── rest/         user-client + app-client (api.ebay.com REST)
│   │   │   ├── scrape/       managed Web Scraper API dispatcher
│   │   │   ├── bridge/       Chrome-extension task names
│   │   │   └── trading/      eBay Trading XML/SOAP wrappers
│   │   ├── shared/           selectTransport, withCache, FlipagentResult, …
│   │   ├── bridge.ts         bridge token + login-status
│   │   ├── bridge-jobs.ts    bridge-job queue + state machine
│   │   ├── compute-jobs/     async /v1/evaluate/jobs queue + dispatcher
│   │   ├── purchases/        REST + bridge transports
│   │   ├── listings/         resource service (rest + Trading XML)
│   │   ├── sales/, money/, disputes/, marketing/, marketplace-meta/
│   │   ├── items/, evaluate/, match/
│   │   ├── quant/            scoring math (cents-denominated, no I/O)
│   │   ├── forwarder/        Planet Express rate tables, dim-weight calc
│   │   └── notifications/, webhooks.ts, observations.ts, trends.ts
│   └── routes/v1/            one file per resource — validates input,
│                             calls the resource service, renders headers
└── drizzle/                  generated migrations
```

Provider folders under `services/ebay/{rest,scrape,bridge,trading}/`
hold all eBay-specific transport code. Resource services
(`services/listings/*`, `services/match/*`, …) are
marketplace-agnostic — they pick a transport via
`selectTransport(...)` from `shared/transport.ts` and dispatch into
the provider. Adding Amazon / Mercari = a sibling
`services/amazon/{rest,scrape,…}/` folder.

## Local dev

```bash
# from repo root
docker compose up -d postgres
cp packages/api/.env.example packages/api/.env
cd packages/api
npm run db:generate     # only after editing schema.ts
npm run db:migrate
npm run dev             # tsx watch
```

`curl localhost:4000/healthz` returns `{"status":"ok",...}`.

### Public tunnel (eBay OAuth, eBay notifications, Stripe webhooks)

Some flows need an HTTPS-reachable hostname pointing at your local API:

- **eBay OAuth callback** — eBay redirects to the RuName's configured URL
  (`https://dev.flipagent.dev/v1/connect/ebay/callback`).
- **eBay Trading API notifications** — pushed to `EBAY_NOTIFY_URL` from
  eBay's servers, must be HTTPS.
- **Stripe webhooks** — likewise pushed to `STRIPE_WEBHOOK_URL`.

Two opt-in commands map `dev.flipagent.dev` → `localhost:$PORT`:

```bash
# Tunnel only — useful when api is already running in another shell
npm run tunnel

# Tunnel + tsx watch in one process (concurrently)
npm run dev:tunnel
```

Plain `npm run dev` stays tunnel-free for everyday work; reach for the
tunnel scripts only when you're testing OAuth / webhooks.

The script (`scripts/dev-tunnel.sh`) is idempotent — first run prompts a
browser login to Cloudflare and creates the tunnel + DNS CNAME; subsequent
runs just start the tunnel. Requires `cloudflared` (`brew install cloudflared`).

Override defaults via env: `PORT=4001 TUNNEL_HOSTNAME=other.example.dev npm run tunnel`.

## Endpoint groups

| Group | Path | Auth | Notes |
|---|---|---|---|
| Liveness | `GET /healthz` | none | Postgres ping |
| Capabilities | `GET /v1/health/features` | none | Which optional features are wired |
| Manifest | `GET /` | none | Lists every advertised path |
| Keys | `GET /v1/keys/me`, `POST /v1/keys/revoke` | API key | Plaintext shown once when issued via dashboard (`POST /v1/me/keys`) |
| Takedown | `POST /v1/takedown` | none | Seller opt-out / DMCA / GDPR |
| Connect | `/v1/connect/ebay/*` | API key | eBay OAuth handshake |
| Billing | `POST /v1/billing/{checkout,portal,webhook}` | mixed | Stripe-driven |
| Dashboard | `GET /v1/me/*` | session | Dashboard backend |
| **Marketplace data** | `GET /v1/items/*`, `GET /v1/items/search?status=sold` | API key | scrape or app-token REST (selectTransport) |
| **Decisions** | `POST /v1/evaluate` (sync) + `/v1/evaluate/jobs/*` (async + SSE + cancel) | API key | composite — detail + sold/active search + LLM same-product filter + score |
| **Operations** | `POST /v1/ship/quote`, `GET /v1/ship/providers` | API key | forwarder math |
| Buy-side | `/v1/purchases/*`, `/v1/featured`, `/v1/bids/*`, `/v1/feeds/*` | API key + (eBay OAuth where applicable) | rest + bridge transports |
| Sell-side write | `/v1/listings/*`, `/v1/listings/bulk/*`, `/v1/listing-groups/*`, `/v1/locations/*`, `/v1/sales/*`, `/v1/offers/*`, `/v1/promotions/*`, `/v1/markdowns/*`, `/v1/ads/*`, `/v1/store/*`, `/v1/labels/*` | API key + eBay OAuth | rest + Trading XML |
| Money + comms | `/v1/payouts/*`, `/v1/transactions/*`, `/v1/transfers/*`, `/v1/messages`, `/v1/feedback`, `/v1/disputes/*`, `/v1/violations/*`, `/v1/policies/*`, `/v1/recommendations`, `/v1/marketplaces`, `/v1/me/seller/*` | API key + eBay OAuth | normalized — cents-int Money + lifecycle status |
| Marketplace meta | `/v1/categories/*`, `/v1/products/*`, `/v1/charities`, `/v1/media/*`, `/v1/translate`, `/v1/analytics/*`, `/v1/feeds/*`, `/v1/saved-searches`, `/v1/watching` | API key (eBay OAuth on writes) | cross-cutting marketplace data |

Authenticated endpoints accept either header:

```
Authorization: Bearer fa_free_xxxxx
X-API-Key: fa_free_xxxxx
```

Each metered call sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` (ISO 8601 next-month boundary).

## Tiers

| Tier | Credits | Refill | Notes |
|---|---|---|---|
| `free` | 500 | one-time (lifetime grant) | Sign up via dashboard, key issued once |
| `hobby` | 3,000 | monthly (UTC) | Stripe upgrade |
| `standard` | 100,000 | monthly (UTC) | Stripe upgrade |
| `growth` | 500,000 | monthly (UTC) | Stripe upgrade |

## Backend chain

Each `/v1/*` request flows through:

1. **Auth + metering** (`middleware/auth.ts`) — API key or session,
   then `usage_events` insert.
2. **Resource service** (`services/<resource>/*`) — flipagent-native
   logic that picks a transport via `selectTransport(...)` from
   `services/shared/transport.ts` (rest / scrape / bridge / trading).
3. **Response cache** (`services/shared/with-cache.ts` →
   `proxy_response_cache`). TTL: 60min for active searches, 4h for
   item detail, 12h for sold prices. Cache hits flip `fromCache`;
   they do not change the `source`.
4. **Provider call** under `services/ebay/{rest,scrape,bridge,trading}/`
   — `rest/{user,app}-client.ts` for eBay REST, the scrape vendor
   dispatcher (Oxylabs today) for HTML, the bridge queue for
   extension-driven ops, or `trading/*` for XML/SOAP.

Every response carries `X-Flipagent-Source` (`scrape`, `rest`,
`bridge`, `trading`, …) plus `X-Flipagent-From-Cache` and
`X-Flipagent-Cached-At` when the response was served from
`proxy_response_cache`.

## Stripe billing

Set the four env vars to enable `/v1/billing/*`. Without them, those
routes return 503 with `error: "billing_not_configured"`; the rest of
the api stays up.

```
STRIPE_SECRET_KEY=sk_live_xxx       # or sk_test_ in dev
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_HOBBY=price_xxx        # recurring monthly product
STRIPE_PRICE_STANDARD=price_xxx
STRIPE_PRICE_GROWTH=price_xxx
```

Wire the webhook URL in the Stripe dashboard:
`https://api.flipagent.dev/v1/billing/webhook`.

## Deploy

Azure Container Apps + Postgres Flexible Server. Terraform module in
`infra/azure/`. CI/CD via `.github/workflows/deploy-api.yml` — builds
via `az acr build` and rolls the Container App revision on every push
to `main`.

## License

[FSL-1.1-ALv2](./LICENSE) — Functional Source License with Apache 2.0
future grant. Source is public on GitHub; not published to npm. Use it
for anything except offering a competing hosted API. Each release
converts to Apache 2.0 two years after publication.
