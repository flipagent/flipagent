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
  (`https://api-dev.flipagent.dev/v1/connect/ebay/callback`).
- **eBay Trading API notifications** — pushed to `EBAY_NOTIFY_URL` from
  eBay's servers, must be HTTPS.
- **Stripe webhooks** — pushed to whatever URL you configured in the Stripe dashboard (typically `${BETTER_AUTH_URL}/v1/billing/webhook` for prod or the tunnel host for dev). The signing secret is read from `STRIPE_WEBHOOK_SECRET`; no env var holds the URL itself — Stripe calls the URL you registered with them, flipagent just verifies signature on receive.

Two opt-in commands map `api-dev.flipagent.dev` → `localhost:$PORT` (and the dashboard at `dev.flipagent.dev` → `localhost:$DASHBOARD_PORT`):

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

Phase 1 surface — what's mounted in `routes/v1/index.ts`. Wrappers exist
for additional surfaces (`charities`, `featured`, `edelivery`,
`violations`, `marketplaces`, `expenses`, `trends`, `promotions`,
`markdowns`, `ads`, `store`, `feeds`, `translate`, `watching`,
`developer`, `cart`, `listings/bulk`, `listing-groups`)
that stay disabled at the route mount until V2; their service code is
ready and re-enables with one uncomment.

| Group | Path | Auth | Notes |
|---|---|---|---|
| Liveness | `GET /healthz`, `GET /v1/health` | none | Postgres ping |
| Manifest | `GET /` | none | Lists every advertised path |
| Keys | `GET /v1/keys/me`, `POST /v1/keys/revoke` | API key | Plaintext shown once when issued via dashboard (`POST /v1/me/keys`) |
| Takedown | `POST /v1/takedown`, `POST /v1/takedown/counter-notice` | none | Seller opt-out + DMCA §512(c)(3) + GDPR Art. 17 + CCPA §1798.105; counter-notice covers §512(g) |
| Connect | `/v1/connect/ebay/*` | API key | eBay OAuth handshake |
| Billing | `POST /v1/billing/{checkout,portal,webhook}` | mixed | Stripe-driven |
| Dashboard | `GET /v1/me/*` | session | Dashboard backend |
| **Marketplace data** | `GET /v1/items/*` (`?status=sold` for sold listings), `GET /v1/categories/*`, `GET /v1/marketplaces/ebay/catalog/*`, `GET /v1/media/*` | API key | scrape or app-token REST (selectTransport) |
| **Decisions** | `POST /v1/evaluate` (sync) + `/v1/evaluate/jobs/*` (async + SSE + cancel) | API key | composite — detail + sold/active search + LLM same-product filter + score |
| **Operations** | `POST /v1/ship/quote`, `GET /v1/ship/providers` | API key | forwarder math |
| Buy-side | `/v1/purchases/*`, `/v1/bids/*`, `/v1/forwarder/*` | API key | response either places the order or returns `nextAction.url` for the user to complete |
| Sell-side write | `/v1/listings/*`, `/v1/locations/*`, `/v1/policies/*`, `/v1/sales/*`, `/v1/labels/*`, `/v1/offers/*` | API key + eBay OAuth | rest + Trading XML |
| Money + comms | `/v1/payouts/*`, `/v1/transactions/*`, `/v1/messages`, `/v1/feedback`, `/v1/disputes/*`, `/v1/recommendations`, `/v1/me/seller/*`, `/v1/analytics/*` | API key + eBay OAuth | normalized — cents-int Money + lifecycle status |
| Notifications | `/v1/notifications/*`, `/v1/webhooks/*` | mixed | eBay platform notifications + outbound webhooks |
| Agent plumbing | `/v1/bridge/*`, `/v1/browser/*`, `/v1/agent/*` | mixed | Extension wire protocol, DOM primitive escape hatch, OpenAI Responses preview |

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
| `free` | 1,000 | one-time (lifetime grant) | Sign up via dashboard, key issued once |
| `hobby` | 3,000 | monthly (UTC) | Stripe upgrade |
| `standard` | 25,000 | monthly (UTC) | Stripe upgrade |
| `growth` | 120,000 | monthly (UTC) | Stripe upgrade |

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
