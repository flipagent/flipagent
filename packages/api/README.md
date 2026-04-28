# @flipagent/api

Hono backend that hosts `api.flipagent.dev`. ONE unified API for the
online reselling cycle — discovery, evaluation, forwarder quoting,
buying, listing, fulfillment, finance — all under `/v1/*`.

The product is the convenience: no eBay OAuth setup, residential proxy
pool, response cache, server-side scoring math, and metering — all
behind a single flipagent API key.

Source-available under [FSL-1.1-ALv2](./LICENSE); marked
`private: true` in `package.json` so it isn't published to npm —
self-hosters clone this repo.

## Layout

```
packages/api/
├── src/
│   ├── server.ts          process entry, signal handlers
│   ├── app.ts             Hono app, middleware, route mounts
│   ├── config.ts          env validation (TypeBox)
│   ├── db/
│   │   ├── client.ts      postgres-js + drizzle handle
│   │   ├── schema.ts      api_keys, usage_events, listings_cache,
│   │   │                  price_history, proxy_response_cache,
│   │   │                  takedown_requests
│   │   └── migrate.ts     `npm run db:migrate`
│   ├── auth/
│   │   ├── keys.ts        generate / hash / lookup / revoke
│   │   ├── limits.ts      tier limits + monthly usage snapshot
│   │   ├── better-auth.ts dashboard session provider
│   │   └── ebay-oauth.ts  eBay user-token + app-token plumbing
│   ├── billing/           Stripe Checkout + webhooks
│   ├── middleware/auth.ts requireApiKey: validate + rate-limit + record
│   ├── proxy/
│   │   ├── scrape.ts      @flipagent/ebay-scraper wrapper
│   │   ├── ebay-passthrough.ts  forwards user/app OAuth to api.ebay.com
│   │   ├── dispatcher.ts  retry + exit-IP rotation
│   │   ├── fetch-tuning.ts UA pool + bot-wall validators
│   │   └── cache.ts       Postgres response cache
│   ├── services/
│   │   ├── scoring/       deal-finding recipes (evaluate, find, signals)
│   │   ├── quant/         median, percentile, IQR, margin math
│   │   └── forwarder/     Planet Express rate tables, dim-weight calc
│   └── routes/
│       ├── health.ts      GET /healthz
│       ├── root.ts        GET / (path manifest)
│       ├── ebay/          marketplace passthrough mounted under /v1/*
│       │   ├── search.ts          /v1/listings/search
│       │   ├── item-detail.ts     /v1/listings/{itemId}
│       │   ├── item-batch.ts      /v1/listings/get_items[_by_item_group]
│       │   ├── sold-search.ts     /v1/sold/search
│       │   ├── order.ts           /v1/orders/checkout/*
│       │   ├── order-v2.ts        /v1/orders/guest/*
│       │   ├── sell-inventory.ts  /v1/inventory/*
│       │   ├── sell-fulfillment.ts /v1/fulfillment/*
│       │   ├── sell-finances.ts   /v1/finance/*
│       │   ├── sell-account.ts    /v1/markets/policies/*
│       │   └── commerce-taxonomy.ts /v1/markets/taxonomy/*
│       └── v1/
│           ├── health.ts    GET /v1/health/features (capability surface)
│           ├── keys.ts      GET /v1/keys/me, POST /v1/keys/revoke
│           ├── connect.ts   /v1/connect/ebay/* (OAuth handshake)
│           ├── billing.ts   /v1/billing/* (Stripe)
│           ├── me.ts        /v1/me/* (dashboard, session-driven)
│           ├── takedown.ts  /v1/takedown
│           ├── evaluate.ts  /v1/evaluate, /v1/evaluate/signals
│           ├── discover.ts  /v1/discover
│           └── ship.ts      /v1/ship/quote, /v1/ship/providers
└── drizzle/                generated migrations
```

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
| **Discovery** | `GET /v1/listings/*`, `GET /v1/sold/*` | API key | scraped or app-token passthrough |
| **Decisions** | `POST /v1/evaluate`, `POST /v1/evaluate/signals` | API key | server-side scoring |
| **Overnight** | `POST /v1/discover` | API key | rank up to 200 items per call |
| **Operations** | `POST /v1/ship/quote`, `GET /v1/ship/providers` | API key | forwarder math |
| Sell-side | `/v1/orders/*`, `/v1/inventory/*`, `/v1/fulfillment/*`, `/v1/finance/*`, `/v1/markets/*` | API key + eBay OAuth | passthrough to api.ebay.com |

Authenticated endpoints accept either header:

```
Authorization: Bearer fa_free_xxxxx
X-API-Key: fa_free_xxxxx
```

Each metered call sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` (ISO 8601 next-month boundary).

## Tiers

| Tier | Calls / month | Notes |
|---|---|---|
| `free` | 100 | Sign up via dashboard, key issued once |
| `hobby` | 5,000 | Stripe upgrade |
| `pro` | 50,000 | Stripe upgrade |
| `business` | unlimited | Custom contract |

## Backend chain

Each marketplace request goes through:

1. **Postgres response cache** (`proxy_response_cache`). TTL: 60min for
   active searches, 4h for item detail, 12h for sold prices.
2. **Scrape via @flipagent/ebay-scraper** (when `EBAY_CLIENT_ID` unset)
   **or OAuth passthrough to api.ebay.com** (when set). The passthrough
   layer translates `/v1/{resource}/...` to eBay's verbose REST paths
   (`/sell/inventory/v1/...`) via the `PATH_MAP` in
   `proxy/ebay-passthrough.ts`.

Every response carries `X-Flipagent-Source` (`cache:scrape`,
`scrape`, `ebay-passthrough`, etc.) and `X-Flipagent-Cached-At` when
relevant.

## Stripe billing

Set the four env vars to enable `/v1/billing/*`. Without them, those
routes return 503 with `error: "billing_not_configured"`; the rest of
the api stays up.

```
STRIPE_SECRET_KEY=sk_live_xxx       # or sk_test_ in dev
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_HOBBY=price_xxx        # recurring monthly product
STRIPE_PRICE_PRO=price_xxx
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
