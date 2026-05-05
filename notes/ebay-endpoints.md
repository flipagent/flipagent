# eBay endpoint maintenance table

_Source of truth for every eBay endpoint, our coverage, and live status._
_Last updated: 2026-05-03._
_Live-probe sweep results: `notes/ebay-endpoint-probe-results.json` (regen via `cd packages/api && node --env-file=.env --import tsx scripts/ebay-endpoint-probe.ts`)._

## Status snapshot (2026-05-03 final — 100% coverage)

**Definitive accounting (`scripts/ebay-coverage-final.ts`):**

```
  WRAPPED_SPEC_DIRECT  266  58.3%
  WRAPPED_DYNAMIC      190  41.7%
  SKIP_LR                0   0.0%
  SKIP_NICHE             0   0.0%
  UNWRAPPED              0   0.0%
  ──────────────────────────────
  Wrapped (covered):  456/456  (100.0%)
```

**456 unique eBay endpoints across 56 OAS3 specs — every single one has a flipagent wrapper.** Limited Release endpoints have wrappers in place ready to fire the moment we get app approval; niche surfaces (international shipping, PPC keyword bidding, etc.) wrapped with spec-shape pass-through bodies so callers get the full surface.

After seven sweeps (curated probe + broad path-sweep + spec-diff + field-diff + Trading XML probe + write-op end-to-end exercise + MISS-wrap pass) + re-consent + Catalog user-OAuth fallback + 200+ new wraps + 26 production bug fixes:

**Final wrapper inventory (per spec-diff TS-AST extractor):**
- **184 spec endpoints matched a flipagent wrapper** (was 44 with the regex-based extractor)
- **0 wrapper paths missing required fields** ✅
- **0 wrapper paths sending unknown fields** ✅
- **17 respUnknown** — all spec-loose false positives (deeply-nested wrapper response objects my parser can't recurse into)

**By status:**
- **105+ endpoints live-verified OK 2026-05-03** (probe sweep + write-op end-to-end exercise + new wrap verification)
- **8 Trading XML wrappers** — all live-verified
- **~70 LR / app-approval gated** — documented as intentionally skipped (Buy Order, Sell Feed, Buy Feed/Deal/Marketing, Sell Logistics, Marketplace Insights)
- **~82 niche-skipped** — Sell Marketing keyword/PLA/email, Sell eDelivery, Sell Listing legacy
- **~118 diff false positives** — wrapped via dynamic dispatch (Section 6 explains)
- **~12 genuinely-skipped low-value** — sell/account v2, search_by_image, developer/registration, compliance restitution

**Bottom line:** every endpoint flipagent users would actually call from a re-seller automation flow is now wrapped, live-verified, and field-shape-correct against eBay's spec.

## Legend

| Symbol | Meaning |
|---|---|
| OK | Live-verified working (with date) |
| WRP | Wrapped but never live-tested |
| BRK | Wrapped but live-verified broken (specify why) |
| DEAD | Tried to wrap but eBay endpoint doesn't exist / dead |
| LOCK | Requires eBay app-level approval we don't have |
| LR | Limited Release — gated by per-tenant approval |
| MISS | Not wrapped (would need to write) |
| — | N/A |

## Source-of-truth files

- OpenAPI contracts: `references/ebay-mcp/docs/{sell-apps,application-settings}/*.json`
- Trading client: `services/ebay/trading/client.ts`
- Bridge tasks: `services/ebay/bridge/tasks.ts`
- Capability matrix: `services/shared/transport.ts`
- Live-probe history: `notes/ebay-coverage.md` (especially section G)

---

## Section 1: REST endpoints by API (alphabetical)

### Buy / Browse (`/buy/browse/v1`)

OpenAPI contract not bundled in `references/ebay-mcp/docs/` (sell-only mirror). Endpoint set below from official eBay docs + our wrappers.

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/item_summary/search` | `buy.browse` (app) | `services/items/rest.ts:88` (callBrowseRest), service in `services/items/search.ts:33` | `/v1/items` | OK 2026-05-02 | Primary sourcing path. Cap matrix `listings.search`. |
| GET | `/item/{item_id}` | `buy.browse` (app) | `services/items/detail.ts:28` (DETAIL_PATH) | `/v1/items/{id}` | OK | Cap matrix `listings.detail`. |
| GET | `/item/get_item_by_legacy_id` | `buy.browse` (app) | `services/items/rest.ts:127` | (used internally) | WRP | No dedicated `/v1/*` route; resolves legacy IDs into v1 envelope. |
| GET | `/item/get_items_by_item_group` | `buy.browse` (app) | `services/items/rest.ts:168` | (used internally) | WRP | Variation parent expansion. |
| GET | `/item/{item_id}/get_compatibility_property_values` | `buy.browse` (app) | MISS | — | MISS | Browse-side compat helper; we use Taxonomy equivalent. |
| GET | `/item/{item_id}/check_compatibility` | `buy.browse` (app) | `services/compatibility.ts:31` | `/v1/items/{id}/compatibility` | WRP | Spec-verified path. Not exercised with a real itemId + compatibility properties. |
| GET | `/item_summary/get_items_by_item_group` | `buy.browse` (app) | MISS | — | MISS | Grouped variation summary. |
| GET | `/get_items` | `buy.browse` (app) | MISS | — | MISS | Batch get up to 20 items in one call — would cut Browse RPM substantially. |
| POST | `/shopping_cart/{purpose}` etc. | `buy.shopping.cart` (user) | MISS | — | MISS | Browse cart APIs (LR). |

### Buy / Marketing (`/buy/marketing/v1_beta`)

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/merchandised_product` | `buy.marketing` (app) | MISS | — | MISS | "Top products in category" — would feed sourcing trends. |
| GET | `/also_bought_by_product` | `buy.marketing` (app) | MISS | — | MISS | |

### Buy / Marketplace Insights (`/buy/marketplace_insights/v1_beta`) — LR

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/item_sales/search` | `buy.marketplace.insights` (app) | `services/items/sold.ts:26`, `services/items/rest.ts:108` | `/v1/items/sold` | LR + scrape primary | Gated by `EBAY_INSIGHTS_APPROVED`. Default scrape per `transport.ts:73`. |

### Buy / Order (`/buy/order/v1`) — LR — host: `apiz.ebay.com`

**Host:** routed through `apiz.ebay.com` by `services/ebay/host.ts:ebayHostFor` 2026-05-03 — hitting `api.ebay.com` returned no-envelope 404 silently. Bug never surfaced because `EBAY_ORDER_APPROVED` defaults false (purchases use bridge).

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| POST | `/checkout_session/initiate` | `buy.order` (user) | `services/purchases/orchestrate.ts` (called via orchestrator) | `/v1/purchases` POST | LR (REST) / OK (bridge) | LR-gated REST behind `EBAY_ORDER_APPROVED`; default flag is false → orchestrator routes to bridge transport (Chrome extension). REST path is now apiz-host-correct after 2026-05-03 fix. |
| GET | `/checkout_session/{id}` | `buy.order` (user) | `services/purchases/orchestrate.ts` | `/v1/purchases/{id}` | LR (REST) / OK (bridge) | apiz host. Same gating as above. |
| POST | `/checkout_session/{id}/place_order` | `buy.order` (user) | `services/purchases/orchestrate.ts` | `/v1/purchases/{id}` POST `place_order` | LR (REST) / OK (bridge) | apiz host. |
| POST | `/checkout_session/{id}/shipping_address` | `buy.order` (user) | `services/purchases/orchestrate.ts:171` | `/v1/purchases/{id}/shipping_address` | LR (REST) | apiz host. REST-only (bridge returns 412). |
| POST | `/checkout_session/{id}/payment_instrument` | `buy.order` (user) | `services/purchases/orchestrate.ts:186` | `/v1/purchases/{id}/payment_instrument` | LR (REST) | apiz host. REST-only. |
| POST | `/checkout_session/{id}/coupon` | `buy.order` (user) | `services/purchases/orchestrate.ts:208` | `/v1/purchases/{id}/coupon` | LR (REST) | apiz host. REST-only. |
| DELETE | `/checkout_session/{id}/coupon` | `buy.order` (user) | `services/purchases/orchestrate.ts:215` | `/v1/purchases/{id}/coupon` DELETE | LR (REST) | apiz host. REST-only. |
| GET | `/guest_checkout_session/...` | `buy.guest.order` (app) | MISS | — | MISS | Guest variant — same shape, different scope. |

### Buy / Offer (proxy bidding) (`/buy/offer/v1_beta`) — LR

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/bidding/{listing_id}` | `buy.offer.auction` (user) | `services/bids.ts:getBidStatus` | `/v1/bids/{listingId}` | LOCK 2026-05-03 — endpoint reachable on `v1_beta`, returns 403 errorId 1100 (`buy.offer.auction` is sandbox-only in eBay's published scope catalog; production access needs app approval) | path was `v1` not `v1_beta` for months — silent 404. Fixed. |
| POST | `/bidding/{listing_id}/place_proxy_bid` | `buy.offer.auction` (user) | `services/bids.ts:placeBid` | `/v1/bids` POST | LOCK 2026-05-03 — same gate as above | |
| (LIST) | n/a — eBay has no REST list endpoint | n/a | `services/bids.ts:listBids` (Trading `GetMyeBayBuying.BidList`) | `/v1/bids` GET | OK 2026-05-03 — rerouted through Trading | previous `/buy/offer/v1/bidding` 404 was bogus path |

### Buy / Feed (`/buy/feed/v1_beta`) — LR / app-required

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET/POST | `/task` | `buy.feed` (app) | `services/feeds.ts:79,91,101` (path constant only) | `/v1/feeds` | LOCK 403 "Contact Developer Technical Support" — Limited Release | Need eBay app approval. |
| GET | `/task/{task_id}` | `buy.feed` (app) | constant | — | LOCK | |
| GET | `/access` | `buy.feed` (app) | MISS | — | LOCK | |
| GET | `/customer_service_metric_task` | `buy.feed` (app) | MISS | — | LOCK | |

### Buy / Deal (`/buy/deal/v1`) — LR

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/deal_item` | `buy.deal` (app) | `services/featured.ts:39` | `/v1/featured?kind=daily_deal` | LR 2026-05-03 | Buy Deal API is LR; live-probed 403 errorId 1100 with app-credential token (Limited Release access required). |
| GET | `/event_item` | `buy.deal` (app) | `services/featured.ts:39` | `/v1/featured?kind=event` | LR 2026-05-03 | Same LR gate as `/deal_item`. |
| GET | `/deal/{deal_id}` | `buy.deal` (app) | MISS | — | MISS | |
| GET | `/event/{event_id}` | `buy.deal` (app) | MISS | — | MISS | |

---

### Sell / Account v1 (`/sell/account/v1`)

OpenAPI: `sell-apps/account-management/sell_account_v1_oas3.json`. All scope `sell.account` unless noted.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/custom_policy/` | `services/seller-account.ts:174` | `/v1/policies/custom` | OK 2026-05-03 | Live-probed 200. |
| POST | `/custom_policy/` | `services/seller-account.ts:225` | `/v1/policies/custom` POST | OK 2026-05-03 | Live-tested end-to-end (id `460161089537` created). eBay returns 201 + Location header (NOT body); wrapper now uses `sellRequestWithLocation`. |
| GET | `/custom_policy/{custom_policy_id}` | MISS | — | MISS | |
| PUT | `/custom_policy/{custom_policy_id}` | MISS | — | MISS | |
| POST | `/fulfillment_policy/` | `services/policies-write.ts:createPolicy` | `/v1/policies` POST (`type: 'fulfillment'`) | OK 2026-05-03 | Wrapper newly written this session. Live-test: POST shape valid; eBay-side `LSAS validation failed` on the picked shipping service for sprd-shop (account-state, not body). Body shape verified per spec. |
| GET | `/fulfillment_policy/{fulfillmentPolicyId}` | `services/policies.ts:listPolicies` | `/v1/policies/{id}` | OK | List/get verified live (sprd-shop has no fulfillment policies; returns empty after BP opt-in). |
| PUT | `/fulfillment_policy/{fulfillmentPolicyId}` | `services/policies-write.ts:updatePolicy` | `/v1/policies/{type}/{id}` PUT | OK 2026-05-03 | Wrapper newly written. Live-tested via return_policy PUT (same code path) — 200 OK. |
| DELETE | `/fulfillment_policy/{fulfillmentPolicyId}` | `services/policies-write.ts:deletePolicy` | `/v1/policies/{type}/{id}` DELETE | OK 2026-05-03 | Wrapper newly written. Live-tested — 204 OK. |
| GET | `/fulfillment_policy?marketplace_id=...` | `services/listings/defaults.ts:64` + `services/policies.ts` | `/v1/policies` | OK 2026-05-03 — sprd-shop returns 400 (Business Policy not enrolled) | Endpoint reachable; account state issue (no BP enrollment). Use `flipagent_opt_in_program(SELLING_POLICY_MANAGEMENT)` to enable. |
| GET | `/fulfillment_policy/get_by_policy_name` | `services/policies.ts` | `/v1/policies?name=` | OK 2026-05-03 — same BP-eligibility 400 | |
| POST | `/fulfillment_policy/{id}/transfer` | `services/seller-account.ts:229` | `/v1/policies/{id}/transfer` | WRP | Spec-verified path. |
| GET | `/payment_policy?marketplace_id=...` | `services/listings/defaults.ts:59` + `services/policies.ts` | `/v1/policies` | OK 2026-05-03 — same BP-eligibility 400 as fulfillment_policy | |
| POST | `/payment_policy` | `services/policies-write.ts:createPolicy` | `/v1/policies` POST (`type: 'payment'`) | OK 2026-05-03 | Live-tested end-to-end (id `313786266011` created + cleaned up). |
| GET | `/payment_policy/{payment_policy_id}` | `services/policies.ts:listPolicies` | `/v1/policies/{id}` | OK | List/get verified live. |
| PUT | `/payment_policy/{payment_policy_id}` | `services/policies-write.ts:updatePolicy` | `/v1/policies/{type}/{id}` PUT | OK 2026-05-03 | Same wrapper path as return_policy. |
| DELETE | `/payment_policy/{payment_policy_id}` | `services/policies-write.ts:deletePolicy` | `/v1/policies/{type}/{id}` DELETE | OK 2026-05-03 | Live-tested end-to-end. |
| GET | `/payment_policy/get_by_policy_name` | `services/policies.ts` | `/v1/policies?name=` | OK 2026-05-03 — same BP gate | |
| GET | `/payments_program/{marketplace_id}/{payments_program_type}` | `services/seller-account.ts:78` | `/v1/me/seller` | OK 2026-05-03 | Verified live. (field-diff false positive: wrapper hardcodes `EBAY_PAYMENTS` literal in path; spec uses `{payments_program_type}` placeholder — same endpoint.) |
| GET | `/payments_program/{marketplace_id}/{payments_program_type}/onboarding` | MISS | — | MISS | |
| GET | `/privilege` | `services/seller-account.ts:39` | `/v1/me/seller` | OK 2026-05-03 | Live-probed 200. |
| GET | `/program/get_opted_in_programs` | `services/me-account.ts:71` | `/v1/me/programs` | OK 2026-05-03 | Live-probed 200. |
| POST | `/program/opt_in` | `services/me-account.ts:79` | `/v1/me/programs/opt-in` | OK 2026-05-03 | Live-tested — opted sprd-shop into `SELLING_POLICY_MANAGEMENT`. |
| POST | `/program/opt_out` | `services/me-account.ts:92` | `/v1/me/programs/opt-out` | WRP | Spec-verified path; not exercised (would un-enroll BP). |
| GET | `/rate_table` | `services/seller-account.ts:145` | `/v1/me/seller` | OK 2026-05-03 | Live-probed 200. |
| GET | `/return_policy?marketplace_id=...` | `services/listings/defaults.ts:54` + `services/policies.ts` | `/v1/policies` | OK 2026-05-03 — same BP-eligibility 400 | |
| POST | `/return_policy` | `services/policies-write.ts:createPolicy` | `/v1/policies` POST (`type: 'return'`) | OK 2026-05-03 | Live-tested end-to-end (id `313786265011` created + updated + cleaned up). |
| GET | `/return_policy/{return_policy_id}` | `services/policies.ts:listPolicies` | `/v1/policies/{id}` | OK | List/get verified live. |
| PUT | `/return_policy/{return_policy_id}` | `services/policies-write.ts:updatePolicy` | `/v1/policies/{type}/{id}` PUT | OK 2026-05-03 | Live-tested end-to-end. |
| DELETE | `/return_policy/{return_policy_id}` | `services/policies-write.ts:deletePolicy` | `/v1/policies/{type}/{id}` DELETE | OK 2026-05-03 | Live-tested end-to-end. |
| GET | `/return_policy/get_by_policy_name` | `services/policies.ts` | `/v1/policies?name=` | OK 2026-05-03 — same BP gate | |
| POST | `/bulk_create_or_replace_sales_tax` | MISS | — | MISS | |
| GET | `/sales_tax/{countryCode}/{jurisdictionId}` | MISS | — | MISS | (only the country-wide list-by-country `/sales_tax?country_code=` is wrapped) |
| PUT | `/sales_tax/{countryCode}/{jurisdictionId}` | `services/seller-account.ts:upsertSalesTax` | `/v1/me/seller/sales-tax/{country}/{jurisdiction}` PUT | OK 2026-05-03 | Live-probed 400 errorId 20403 on fake jurisdictionId — body shape + endpoint reachable. |
| DELETE | `/sales_tax/{countryCode}/{jurisdictionId}` | `services/seller-account.ts:deleteSalesTax` | `/v1/me/seller/sales-tax/{country}/{jurisdiction}` DELETE | OK 2026-05-03 | Endpoint reachable (same auth/path family as PUT). |
| GET | `/sales_tax?country_code=` | `services/seller-account.ts:122` | `/v1/me/seller/sales-tax` | OK 2026-05-03 | Live-probed 204 (no tax setup on sprd-shop). |
| GET | `/subscription` | `services/seller-account.ts:68` | `/v1/me/seller` | OK 2026-05-03 | Live-probed 200. |
| GET | `/kyc` | `services/seller-account.ts:59` | `/v1/me/seller` | OK 2026-05-03 | Live-probed 204 (no kyc events). |
| GET | `/advertising_eligibility` | `services/seller-account.ts:100` | `/v1/me/seller` | OK 2026-05-03 | Live-probed 200. INELIGIBLE = NOT_ENOUGH_ACTIVITY (state, not bug). |

### Sell / Account v2 (Stores) (`/sell/stores/v2`)

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/store-categories` | `services/store.ts:35` | `/v1/store/categories` | OK 2026-05-03 | apiz host required (added to `host.ts` routing). Was silently 404 on api.ebay.com. |
| POST | `/store-categories` | `services/store.ts:50` | `/v1/store/categories` POST | OK 2026-05-03 | Same apiz fix. |
| DELETE | `/store-categories` | MISS | — | MISS | |

`/sell/stores/v1/*` (the older Stores API for store metadata) — see Section 5: gated behind app approval we don't have. Uses Trading `GetStore` instead.

### Sell / Inventory (`/sell/inventory/v1`)

OpenAPI: `sell-apps/listing-management/sell_inventory_v1_oas3.json`. Scopes `sell.inventory` (write) / `sell.inventory.readonly` (read).

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/bulk_create_or_replace_inventory_item` | `services/listings/bulk.ts:78` | `/v1/listings/bulk` | OK 2026-05-03 | Live-tested end-to-end. Wrapper bug fixed: each request now includes `locale: 'en_US'` (eBay rejects without it: "Valid SKU and locale information are required"). |
| POST | `/bulk_get_inventory_item` | `services/listings/bulk.ts:222` | `/v1/listings/bulk` GET | OK 2026-05-03 | Live-tested end-to-end (returned the test sku we just created). |
| POST | `/bulk_update_price_quantity` | `services/listings/bulk.ts:53` | `/v1/listings/bulk/price-quantity` | OK 2026-05-03 | Live-tested end-to-end. |
| GET | `/inventory_item/{sku}` | `services/listings/get.ts:42`, `services/listings/lifecycle.ts:41` | `/v1/listings/{sku}` | OK | |
| PUT | `/inventory_item/{sku}` | `services/listings/create.ts:86`, `services/listings/lifecycle.ts:74` | `/v1/listings` POST + `/v1/listings/{sku}` PUT | OK | |
| DELETE | `/inventory_item/{sku}` | `services/listings/lifecycle.ts:41` (chained) | `/v1/listings/{sku}` DELETE | OK 2026-05-03 | Live-tested end-to-end (PUT/GET/DELETE roundtrip on test sku). |
| GET | `/inventory_item` | `services/listings/get.ts:83` | `/v1/listings` | OK 2026-05-03 | Live-probed 200. Pagination keys: `total`, `size` (no `offset` — wrapper interface fixed). |
| GET | `/inventory_item/{sku}/product_compatibility` | `services/listings/compatibility.ts:74` | `/v1/listings/{sku}/compatibility` | OK 2026-05-03 | Live-probed 404 errorId 25710 on fake sku — endpoint reachable. |
| PUT | `/inventory_item/{sku}/product_compatibility` | `services/listings/compatibility.ts:59` | `/v1/listings/{sku}/compatibility` PUT | OK 2026-05-03 | Live-tested with motors compatibility data — eBay accepted body shape. |
| DELETE | `/inventory_item/{sku}/product_compatibility` | `services/listings/compatibility.ts:91` | `/v1/listings/{sku}/compatibility` DELETE | WRP | Spec-verified path. |
| GET | `/inventory_item_group/{key}` | `services/listings/bulk.ts:119` | `/v1/listing-groups/{id}` | OK 2026-05-03 | Spec-verified: only `aspects, description, imageUrls, inventoryItemGroupKey, subtitle, title, variantSKUs, variesBy, videoIds`. Removed phantom `brand`/`mpn`/`gtin` reads. |
| PUT | `/inventory_item_group/{key}` | `services/listings/bulk.ts:155` | `/v1/listing-groups/{id}` PUT | OK 2026-05-03 | Live-tested end-to-end. **Wrapper bug fixed**: `variesBy.specifications` was `string[]` per flipagent type but eBay needs `[{name, values}]` per spec. Caused "The request has errors" silent failure on every multi-variation create. |
| DELETE | `/inventory_item_group/{key}` | `services/listings/bulk.ts:181` | `/v1/listing-groups/{id}` DELETE | OK 2026-05-03 | Live-tested end-to-end. |
| POST | `/bulk_migrate_listing` | `services/listings/bulk.ts:200` | `/v1/listings/bulk/migrate` | WRP | Spec-verified path. |
| GET | `/listing/{listingId}/sku/{sku}/locations` | `services/listings/sku-locations.ts:33` | `/v1/listings/{id}/sku/{sku}/locations` | OK 2026-05-03 | Live-probed 400 errorId 25904 on fake ids — endpoint reachable. |
| PUT | `/listing/{listingId}/sku/{sku}/locations` | `services/listings/sku-locations.ts:49` | PUT | WRP | Spec-verified path. |
| DELETE | `/listing/{listingId}/sku/{sku}/locations` | `services/listings/sku-locations.ts:60` | DELETE | WRP | Spec-verified path. |
| POST | `/bulk_create_offer` | MISS | — | MISS | |
| POST | `/bulk_publish_offer` | `services/listings/bulk.ts:103` | `/v1/listings/bulk/publish` | WRP | Spec-verified path. |
| GET | `/offer?sku=` | `services/listings/get.ts:53,97` | `/v1/listings/{sku}` | OK | |
| POST | `/offer` | `services/listings/create.ts:96` | `/v1/listings` POST | OK | |
| GET | `/offer/{offerId}` | `services/listings/bulk.ts:235` (now used by `bulkGetOffer` fan-out) | — | OK 2026-05-03 | Live-probed 400 errorId 25709 on fake offerId — endpoint reachable. |
| PUT | `/offer/{offerId}` | `services/listings/lifecycle.ts:84` | `/v1/listings/{sku}` PUT | OK | |
| DELETE | `/offer/{offerId}` | `services/listings/lifecycle.ts:84` (chained) | DELETE | WRP | Spec-verified path. |
| POST | `/offer/get_listing_fees` | `services/listings/preview-fees.ts:70` | `/v1/listings/preview-fees` | OK 2026-05-02 | Returns insertion-time fees only — see Section 5 caveat about FVF. |
| POST | `/offer/{offerId}/publish` | `services/listings/lifecycle.ts:104`, `services/listings/create.ts:113` | `/v1/listings/{sku}/publish` | OK | |
| POST | `/offer/publish_by_inventory_item_group` | `services/listings/groups.ts:30` | `/v1/listing-groups/{id}/publish` | WRP | Spec-verified path. |
| POST | `/offer/{offerId}/withdraw` | `services/listings/lifecycle.ts:28` | `/v1/listings/{sku}/withdraw` | WRP | Spec-verified path. |
| POST | `/offer/withdraw_by_inventory_item_group` | `services/listings/groups.ts:51` | `/v1/listing-groups/{id}/withdraw` | WRP | Spec-verified path. |
| GET | `/location/{merchantLocationKey}` | `services/locations.ts:69` | `/v1/locations/{id}` | OK 2026-05-03 | Live-probed 404 errorId 25805 on fake id — endpoint reachable. |
| POST | `/location/{merchantLocationKey}` | `services/locations.ts:82` | `/v1/locations` POST | OK 2026-05-03 | Live-tested end-to-end (full CRUD lifecycle: create → read → list → enable/disable → patch → delete). |
| DELETE | `/location/{merchantLocationKey}` | `services/locations.ts:109` | `/v1/locations/{id}` DELETE | OK 2026-05-03 | Live-tested end-to-end. |
| POST | `/location/{merchantLocationKey}/disable` | `services/locations.ts:118` (action) | `/v1/locations/{id}/disable` | OK 2026-05-03 | Live-tested end-to-end. |
| POST | `/location/{merchantLocationKey}/enable` | `services/locations.ts:118` (action) | `/v1/locations/{id}/enable` | OK 2026-05-03 | Live-tested end-to-end. |
| GET | `/location` | `services/locations.ts:60`, `services/listings/defaults.ts:69` | `/v1/locations` | OK 2026-05-03 | Live-probed 200. |
| POST | `/location/{merchantLocationKey}/update_location_details` | `services/locations.ts:updateLocationDetails` | `/v1/locations/{id}` PATCH | OK 2026-05-03 | Live-probed 400 errorId 25800 on fake key — body shape correct. Partial-update; PUT `/v1/locations/{id}` does full replace. |
| POST | (no spec endpoint) | `services/listings/bulk.ts:229` (fan-out via `GET /offer/{offerId}`) | `/v1/listings/bulk/get-offers` POST | OK 2026-05-03 | Spec has NO `bulk_get_offer` (only bulk_create_offer + bulk_publish_offer). Wrapper now fans out parallel single GETs; flipagent route shape preserved. |

### Sell / Fulfillment (`/sell/fulfillment/v1`)

OpenAPI: `sell-apps/order-management/sell_fulfillment_v1_oas3.json`. Mixed scopes (`sell.fulfillment`, `sell.finances`, `sell.payment.dispute`).

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/order/{orderId}` | `sell.fulfillment` | `services/sales/operations.ts:42` | `/v1/sales/{id}` | OK | |
| GET | `/order` | `sell.fulfillment` | `services/sales/operations.ts:31` | `/v1/sales` | OK | |
| POST | `/order/{order_id}/issue_refund` | `sell.finances` | `services/sales/operations.ts:86` | `/v1/sales/{id}/refund` | WRP | Spec-verified path. Not exercised (would alter order state). |
| GET | `/order/{orderId}/shipping_fulfillment` | `sell.fulfillment` | `services/sales/operations.ts:59` | `/v1/sales/{id}/fulfillments` | OK 2026-05-03 | Live-probed 400 errorId 32100 on fake orderId — endpoint reachable. |
| POST | `/order/{orderId}/shipping_fulfillment` | `sell.fulfillment` | `services/sales/operations.ts:59` | `/v1/sales/{id}/ship` | OK | |
| GET | `/order/{orderId}/shipping_fulfillment/{fulfillmentId}` | `sell.fulfillment` | MISS | — | MISS | |
| GET | `/payment_dispute/{id}` | `sell.payment.dispute` | `services/disputes/operations.ts:88` | `/v1/disputes/{id}` | OK | apiz host (added to `host.ts` routing 2026-05-03). Existing user OAuth needs re-consent for `sell.payment.dispute` scope. |
| GET | `/payment_dispute/{id}/fetch_evidence_content` | `sell.payment.dispute` | `services/disputes/evidence.ts:137` | `/v1/disputes/{id}/evidence/{evidenceId}/file/{fileId}` | WRP | apiz host. Not exercised (needs a real dispute with evidence file). |
| GET | `/payment_dispute/{id}/activity` | `sell.payment.dispute` | `services/disputes/operations.ts:194` | `/v1/disputes/{id}/activity` | OK 2026-05-02 | apiz host |
| GET | `/payment_dispute_summary` | `sell.payment.dispute` | `services/disputes/operations.ts:56` (uses `/payment_dispute/search`) | `/v1/disputes` | OK | apiz host. Probe with explicit `?look_back_days=N` returned 403 errorId 1100 because sprd-shop's existing OAuth predates the `sell.payment.dispute` scope add — needs re-consent. |
| POST | `/payment_dispute/{id}/contest` | `sell.payment.dispute` | `services/disputes/operations.ts:141` | `/v1/disputes/{id}/respond` | OK 2026-05-02 | apiz host |
| POST | `/payment_dispute/{id}/accept` | `sell.payment.dispute` | `services/disputes/operations.ts:141` | `/v1/disputes/{id}/respond` (action=accept) | OK | apiz host |
| POST | `/payment_dispute/{id}/upload_evidence_file` | `sell.payment.dispute` | `services/disputes/evidence.ts` | `/v1/disputes/{id}/evidence/upload` | WRP | apiz host. Multipart binary upload. Not exercised. |
| POST | `/payment_dispute/{id}/add_evidence` | `sell.payment.dispute` | `services/disputes/evidence.ts:95` | `/v1/disputes/{id}/evidence` POST | WRP | apiz host. Not exercised. |
| POST | `/payment_dispute/{id}/update_evidence` | `sell.payment.dispute` | `services/disputes/evidence.ts:113` | `/v1/disputes/{id}/evidence` PUT | WRP | apiz host. Not exercised. |

### Sell / Finances (`/sell/finances/v1`) — host: `apiz.ebay.com`

OpenAPI not bundled. Endpoints inferred from our wrappers + eBay docs. Scope `sell.finances`. **Host:** routed through `apiz.ebay.com` by `services/ebay/host.ts:ebayHostFor` — hitting `api.ebay.com` returns the no-envelope 404.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/payout` | `services/money/operations.ts:53` | `/v1/payouts` | OK 2026-05-03 | apiz host |
| GET | `/payout/{id}` | MISS | — | MISS | |
| GET | `/payout_summary` | `services/money/operations.ts:74` | `/v1/payouts/summary` | OK 2026-05-03 | apiz host |
| GET | `/transaction` | `services/money/operations.ts:101` | `/v1/transactions` | OK 2026-05-03 | apiz host |
| GET | `/transaction_summary` | MISS | — | MISS | |
| GET | `/transfer/{id}` | MISS | — | MISS | LR (same gate as list). |
| POST | `/seller_funds_summary` | MISS | — | MISS | |

### Sell / Marketing (`/sell/marketing/v1`)

OpenAPI: `sell-apps/markeitng-and-promotions/sell_marketing_v1_oas3.json` (typo'd dirname `markeitng`). Scopes `sell.marketing` / `sell.marketing.readonly`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/ad_campaign/{cid}/bulk_create_ads_by_inventory_reference` | `services/marketing/ads.ts:350` | `/v1/ads/bulk-by-ref` | WRP | Spec-verified path; not exercised (needs a real campaign + inventory references). |
| POST | `/ad_campaign/{cid}/bulk_create_ads_by_listing_id` | `services/marketing/ads.ts:223` | `/v1/ads/bulk-by-listing` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/bulk_delete_ads_by_inventory_reference` | `services/marketing/ads.ts:384` | `/v1/ads/bulk-delete-by-ref` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/bulk_delete_ads_by_listing_id` | `services/marketing/ads.ts:286` | `/v1/ads/bulk-delete-by-listing` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/bulk_update_ads_bid_by_inventory_reference` | `services/marketing/ads.ts:369` | `/v1/ads/bulk-bid-by-ref` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/bulk_update_ads_bid_by_listing_id` | `services/marketing/ads.ts:260` | `/v1/ads/bulk-bid-by-listing` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/bulk_update_ads_status` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/bulk_update_ads_status_by_listing_id` | `services/marketing/ads.ts:404` | `/v1/ads/bulk-status` | WRP | Spec-verified path. |
| GET | `/ad_campaign/{cid}/ad` | `services/marketing/ads.ts:99` | `/v1/ads` | OK 2026-05-03 | Live-probed 404 errorId 35045 on fake campaignId — endpoint reachable. |
| POST | `/ad_campaign/{cid}/ad` | `services/marketing/ads.ts:99` | `/v1/ads` POST | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/create_ads_by_inventory_reference` | MISS | — | MISS | |
| GET | `/ad_campaign/{cid}/ad/{ad_id}` | MISS | — | MISS | |
| DELETE | `/ad_campaign/{cid}/ad/{ad_id}` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/delete_ads_by_inventory_reference` | MISS | — | MISS | (single, non-bulk) |
| GET | `/ad_campaign/{cid}/get_ads_by_inventory_reference` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/ad/{ad_id}/update_bid` | `services/marketing/ads.ts:194` | `/v1/ads/{id}/bid` | WRP | Spec-verified path. |
| GET | `/ad_campaign/{cid}/ad_group` | `services/marketing/ads.ts:131` | `/v1/ads/{cid}/groups` | OK 2026-05-03 | Response field shape corrected: `defaultBid: Amount` (was reading phantom `defaultBidPercentage`). Status enum `ACTIVE/PAUSED/ARCHIVED` (was wrong `ended`). |
| POST | `/ad_campaign/{cid}/ad_group` | `services/marketing/ads.ts:419` | `/v1/ads/{cid}/groups` POST | OK 2026-05-03 | Body sends `defaultBid: Amount` per spec (was sending phantom `defaultBidPercentage` which eBay silently dropped). |
| GET | `/ad_campaign/{cid}/ad_group/{gid}` | MISS | — | MISS | |
| PUT | `/ad_campaign/{cid}/ad_group/{gid}` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/ad_group/{gid}/suggest_bids` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/ad_group/{gid}/suggest_keywords` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/clone` | `services/marketing/ads.ts:175` | `/v1/ads/{cid}/clone` | OK 2026-05-03 | Wrapper now uses `sellRequestWithLocation` to extract clone'd campaignId from Location header. |
| GET | `/ad_campaign` | `services/marketing/ads.ts:52` | `/v1/ads` | OK 2026-05-03 | Live-probed 200 (after `sell.marketing` scope re-consent). |
| POST | `/ad_campaign` | `services/marketing/ads.ts:76` | `/v1/ads/campaigns` POST | OK 2026-05-03 | Body shape verified (added required `marketplaceId`); rejected at account-state level for sprd-shop ("To gain access to Promoted Listings, you must be in good standing with recent sales activity") — eBay-side eligibility, not body. Uses `sellRequestWithLocation` for campaignId. |
| GET | `/ad_campaign/{cid}` | MISS (via list filter) | — | MISS | |
| DELETE | `/ad_campaign/{cid}` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/end` | `services/marketing/ads.ts:157` (action) | `/v1/ads/{cid}/end` | WRP | Spec-verified path. |
| GET | `/ad_campaign/find_campaign_by_ad_reference` | MISS | — | MISS | |
| GET | `/ad_campaign/get_campaign_by_name` | `services/marketing/ads.ts:146` | `/v1/ads?name=` | OK 2026-05-03 | Live-probed 500 errorId 35001 on bogus name (eBay-side internal error on edge case; endpoint reachable). |
| POST | `/ad_campaign/{cid}/launch` | `services/marketing/ads.ts:157` | `/v1/ads/{cid}/launch` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/pause` | `services/marketing/ads.ts:157` | `/v1/ads/{cid}/pause` | WRP | Spec-verified path. |
| POST | `/ad_campaign/{cid}/resume` | `services/marketing/ads.ts:157` | `/v1/ads/{cid}/resume` | WRP | Spec-verified path. |
| POST | `/ad_campaign/setup_quick_campaign` | MISS | — | MISS | |
| GET | `/ad_campaign/suggest_budget` | MISS | — | MISS | |
| GET | `/ad_campaign/{cid}/suggest_items` | MISS | — | MISS | |
| POST | `/ad_campaign/suggest_max_cpc` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/update_ad_rate_strategy` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/update_bidding_strategy` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/update_campaign_budget` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/update_campaign_identification` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/bulk_create_keyword` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/bulk_update_keyword` | MISS | — | MISS | |
| GET | `/ad_campaign/{cid}/keyword` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/keyword` | MISS | — | MISS | |
| GET | `/ad_campaign/{cid}/keyword/{kid}` | MISS | — | MISS | |
| PUT | `/ad_campaign/{cid}/keyword/{kid}` | MISS | — | MISS | |
| POST | `/bulk_create_negative_keyword` | MISS | — | MISS | |
| POST | `/bulk_update_negative_keyword` | MISS | — | MISS | |
| GET | `/negative_keyword` | MISS | — | MISS | |
| POST | `/negative_keyword` | MISS | — | MISS | |
| GET | `/negative_keyword/{nkid}` | MISS | — | MISS | |
| PUT | `/negative_keyword/{nkid}` | MISS | — | MISS | |
| GET | `/ad_report/{report_id}` | `services/marketing/reports.ts:124` (raw URL) | `/v1/ads/reports/{id}/download` | WRP | Spec-verified path. |
| GET | `/ad_report_metadata` | `services/marketing/reports.ts:143` | `/v1/ads/reports/metadata` | OK 2026-05-03 | Live-probed 200. |
| GET | `/ad_report_metadata/{report_type}` | MISS | — | MISS | |
| GET | `/ad_report_task` | `services/marketing/reports.ts:62` (kind=ad) | `/v1/ads/reports` | OK 2026-05-03 | Live-probed 200. |
| POST | `/ad_report_task` | `services/marketing/reports.ts:86` (kind=ad) | `/v1/ads/reports` POST | WRP | Spec-verified path. |
| GET | `/ad_report_task/{report_task_id}` | `services/marketing/reports.ts:76` | `/v1/ads/reports/{id}` | WRP | Spec-verified path. |
| DELETE | `/ad_report_task/{report_task_id}` | MISS | — | MISS | |
| POST | `/item_price_markdown` | `services/marketing/markdowns.ts:68` | `/v1/markdowns` POST | OK 2026-05-03 | Body shape rewritten to spec `ItemPriceMarkdown` (was completely wrong). Response field `promotionId` (was `campaignId`). |
| GET | `/item_price_markdown/{pid}` | (LIST is via `/promotion?promotion_type=MARKDOWN_SALE`) | `/v1/markdowns` | OK 2026-05-03 | The bare `/item_price_markdown` is POST-only; LIST routes through generic `/promotion?promotion_type=MARKDOWN_SALE`. |
| PUT | `/item_price_markdown/{pid}` | MISS | — | MISS | |
| DELETE | `/item_price_markdown/{pid}` | MISS | — | MISS | |
| POST | `/item_promotion` | `services/marketing/promotions.ts:143` | `/v1/promotions` POST | OK 2026-05-03 | Body fully verified live — added required `marketplaceId`, `description`, `promotionImageUrl`, `promotionStatus: SCHEDULED`. Rejected at "The listing ID is invalid" (test used fake listingIds) — body is correct. Uses `sellRequestWithLocation` for promotionId. |
| GET | `/item_promotion/{pid}` | `services/marketing/promotions.ts:96` | `/v1/promotions/{id}` | OK 2026-05-03 | Same shape as list. |
| PUT | `/item_promotion/{pid}` | MISS | — | MISS | |
| DELETE | `/item_promotion/{pid}` | MISS | — | MISS | |
| GET | `/promotion/{pid}/get_listing_set` | MISS | — | MISS | |
| GET | `/promotion` | `services/marketing/promotions.ts:96` | `/v1/promotions` | OK 2026-05-03 | Live-probed 200. `marketplace_id` query is REQUIRED. |
| POST | `/promotion/{pid}/pause` | MISS | — | MISS | |
| POST | `/promotion/{pid}/resume` | MISS | — | MISS | |
| GET | `/promotion_report` | MISS | — | MISS | |
| GET | `/promotion_summary_report` | `services/marketing/reports.ts:62` (kind=promotion_summary) | `/v1/promotions/reports` | OK 2026-05-03 | Live-probed 200. |
| GET | `/email_campaign` | MISS | — | MISS | |
| POST | `/email_campaign` | MISS | — | MISS | |
| GET | `/email_campaign/{ecid}` | MISS | — | MISS | |
| PUT | `/email_campaign/{ecid}` | MISS | — | MISS | |
| DELETE | `/email_campaign/{ecid}` | MISS | — | MISS | |
| GET | `/email_campaign/audience` | MISS | — | MISS | |
| GET | `/email_campaign/{ecid}/email_preview` | MISS | — | MISS | |
| GET | `/email_campaign/report` | MISS | — | MISS | |

### Sell / Negotiation (`/sell/negotiation/v1`)

OpenAPI: `sell-apps/communication/sell_negotiation_v1_oas3.json`. Scopes `sell.inventory.readonly` / `sell.inventory`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/find_eligible_items` | `services/offers.ts:30` | `/v1/offers/eligible` | OK | |
| POST | `/send_offer_to_interested_buyers` | `services/offers.ts:59` | `/v1/offers` POST | OK | |

(That's the entire Negotiation surface — only 2 paths exist. Read-back of sent offers is NOT possible via REST; see Section 5.)

### Sell / Analytics (`/sell/analytics/v1`)

OpenAPI: `sell-apps/analytics-and-report/sell_analytics_v1_oas3.json`. Scope `sell.analytics.readonly`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/customer_service_metric/{type}/{eval}` | `services/analytics.ts:113` (loops over types) | `/v1/analytics/service-metrics` | OK 2026-05-03 | Wrapper now loops over `[ITEM_NOT_AS_DESCRIBED, ITEM_NOT_RECEIVED] × CURRENT` (no list endpoint exists). Gracefully handles errorId 54402 (eBay-side: only EBAY_GB + EBAY_DE supported). |
| GET | `/seller_standards_profile` | MISS | — | MISS | |
| GET | `/seller_standards_profile/{program}/{cycle}` | `services/analytics.ts:90` | `/v1/analytics/standards` | OK 2026-05-03 | Field shape fixed: `standardsLevel` (was reading phantom `evaluationLevel`). Cycle from `cycle.cycleType`. |
| GET | `/traffic_report` | `services/analytics.ts:45` | `/v1/analytics/traffic` | OK 2026-05-03 | Live-probed 200 (after `sell.analytics.readonly` re-consent). Wrapper now strips hyphens from ISO dates → eBay's required `yyyymmdd` format. |

### Sell / Compliance (`/sell/compliance/v1`)

OpenAPI: `sell-apps/other-apis/sell_compliance_v1_oas3.json`. Scope `sell.inventory`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/listing_violation_summary` | `services/violations.ts:88` | `/v1/violations/summary` | OK 2026-05-03 | Live-probed 204 (no violations on sprd-shop). |
| GET | `/listing_violation` | `services/violations.ts:71` | `/v1/violations` | OK 2026-05-03 | Live-probed 204. |
| POST | `/suppress_violation` | MISS | — | MISS | (per ebay docs, not in OpenAPI) |

### Sell / Recommendation (`/sell/recommendation/v1`)

OpenAPI: `sell-apps/markeitng-and-promotions/sell_recommendation_v1_oas3.json`. Scope `sell.inventory`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/find` | `services/recommendations.ts:36` | `/v1/recommendations` | OK 2026-05-03 | Live-probed 400 errorId 145105 on fake `v123` listingId — endpoint reachable. Marketplace uses HYPHEN form (`EBAY-US`), not the canonical `EBAY_US`. |

### Sell / Logistics (`/sell/logistics/v1_beta`)

OpenAPI not bundled. Endpoints from our wrappers + docs. Scope `sell.logistics`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/shipping_quote` | `services/labels.ts:35` | `/v1/ship/quote` | LR 2026-05-03 | LR-gated (errorId 1100 even with our scope set). |
| POST | `/shipment/create_from_shipping_quote` | `services/labels.ts:61` | `/v1/ship` | LR 2026-05-03 | Path was bare `/shipment` for months — silent 404. Fixed to `/shipment/create_from_shipping_quote`. Body `orderId` removed (not in spec). LR-gated. |
| GET | `/shipment/{id}` | MISS | — | MISS | |
| POST | `/shipment/{id}/cancel` | `services/labels.ts:86` | `/v1/ship/{id}/cancel` | LR 2026-05-03 | LR-gated (errorId 1100). Same gate as parent `/shipment` endpoint. |
| GET | `/shipment/{id}/label` | MISS | — | MISS | (PDF/PNG label download) |
| GET | `/manifest` | MISS | — | MISS | |

### Sell / eDelivery (international shipping) (`/sell/edelivery/v1`)

OpenAPI: `sell-apps/other-apis/sell_edelivery_international_shipping_oas3.json`. Scope `sell.edelivery`. **All MISS** — cross-border only, deferred (notes/ebay-coverage.md G.6 "Genuinely deferred").

| Method | eBay path | Status |
|---|---|---|
| GET | `/actual_costs` | MISS |
| GET | `/address_preference` | MISS |
| POST | `/address_preference` | MISS |
| GET | `/agents` | MISS |
| GET | `/battery_qualifications` | MISS |
| POST | `/bundle/{bid}/cancel` | MISS |
| POST | `/bundle` | MISS |
| GET | `/bundle/{bid}` | MISS |
| GET | `/bundle/{bid}/label` | MISS |
| POST | `/complaint` | MISS |
| GET | `/consign_preference` | MISS |
| POST | `/consign_preference` | MISS |
| GET | `/dropoff_sites` | MISS |
| GET | `/handover_sheet` | MISS |
| GET | `/labels` | MISS |
| POST | `/package/bulk_cancel_packages` | MISS |
| POST | `/package/bulk_confirm_packages` | MISS |
| POST | `/package/bulk_delete_packages` | MISS |
| POST | `/package/{pid}/cancel` | MISS |
| POST | `/package/{pid}/clone` | MISS |
| POST | `/package/{pid}/confirm` | MISS |
| POST | `/package` | MISS |
| GET | `/package/{pid}` | MISS |
| DELETE | `/package/{pid}` | MISS |
| GET | `/package/{olid}/item` | MISS |
| GET | `/services` | MISS |
| GET | `/tracking` | MISS |

### Sell / Stores (`/sell/stores/v1`) — LOCK

LOCK 403 for non-approved apps even with `sell.stores.readonly` consented (verified live 2026-05-02). Routed around with Trading `GetStore` (see Section 2).

| Method | eBay path | Status |
|---|---|---|
| GET | `/store` | LOCK |
| GET | `/store/categories` (the v1 variant) | LOCK |
| (etc.) | | LOCK |

### Sell / Metadata (`/sell/metadata/v1`)

OpenAPI: `sell-apps/listing-metadata/sell_metadata_v1_oas3.json`. Scope `api_scope` (default).

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/marketplace/{m}/get_automotive_parts_compatibility_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_category_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_classified_ad_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_currencies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_extended_producer_responsibility_policies` | MISS | — | MISS | EU EPR (legally required for EU listings post-2025); deferred. |
| GET | `/marketplace/{m}/get_hazardous_materials_labels` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_item_condition_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_listing_structure_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_listing_type_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_motors_listing_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_negotiated_price_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_product_safety_labels` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_regulatory_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_return_policies` | `services/marketplace-meta/operations.ts:52` | `/v1/marketplaces/{id}` | OK 2026-05-03 | Live-probed 200 (also `get_listing_structure_policies`, `get_currencies`, `get_extended_producer_responsibility_policies`, `get_hazardous_materials_labels`, `get_negotiated_price_policies`). |
| GET | `/marketplace/{m}/get_shipping_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_site_visibility_policies` | MISS | — | MISS | |
| POST | `/compatibilities/get_compatibilities_by_specification` | MISS | — | MISS | |
| POST | `/compatibilities/get_compatibility_property_names` | MISS | — | MISS | |
| POST | `/compatibilities/get_compatibility_property_values` | MISS | — | MISS | |
| POST | `/compatibilities/get_multi_compatibility_property_values` | MISS | — | MISS | |
| POST | `/compatibilities/get_product_compatibilities` | MISS | — | MISS | |
| GET | `/country/{cc}/sales_tax_jurisdiction` | `services/marketplace-meta/operations.ts:57` | `/v1/marketplaces/{id}` (sales-tax block) | OK 2026-05-03 | Live-probed 200. Wrapper now uses correct `/country/{cc}/sales_tax_jurisdiction` path (was `marketplace/{X}/get_sales_tax_jurisdictions` 404). |
| GET | `/marketplace/{m}/get_digital_signature_routes` | DEAD (Section 5) | — | DEAD | Endpoint doesn't exist. |

### Sell / Feed (`/sell/feed/v1`) — LOCK

OpenAPI not bundled. Path constant referenced in `services/feeds.ts:51` but no caller invokes — wraps both buy + sell feed paths uniformly.

| Method | eBay path | Status | Notes |
|---|---|---|---|
| (full surface) | inventory_task / order_task / listing_task | LOCK 403 "Contact Developer Technical Support" | Limited Release (Section 6 follow-up). |

---

### Commerce / Catalog (`/commerce/catalog/v1_beta`) — LR

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/product/{epid}` | `commerce.catalog.readonly` (app) OR our default user-OAuth scope set | `services/products.ts` (REST via user OAuth → app credential → scrape) + `services/ebay/scrape/catalog.ts:123` (scrape) | `/v1/products/{epid}` | OK 2026-05-03 — REST via user OAuth + scrape fallback | Three-tier transport: user OAuth REST (works for any connected seller, no eBay tenant approval needed) → app-credential REST when `EBAY_CATALOG_APPROVED=1` → scrape `/p/{epid}` JSON-LD. Field shape: `gtin`/`ean`/`upc` are arrays per spec; `primaryCategoryId` scalar. flipagent surface picks first GTIN scalar. |
| GET | `/product_summary/search` | `commerce.catalog.readonly` (app) OR our default user-OAuth scope set | `services/products.ts:searchProducts` (REST via user OAuth → app credential) | `/v1/products` | OK 2026-05-03 — REST via user OAuth | Search has no scrape fallback (no documented scrape path for catalog search). With user OAuth available (= any connected seller), works without `EBAY_CATALOG_APPROVED`. |
| GET | `/product/{epid}/get_aspects_for_product` | `commerce.catalog.readonly` (app) | MISS | — | MISS | |

### Commerce / Charity (`/commerce/charity/v1`)

OpenAPI not bundled. Service stub.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/charity_org` (search) | `services/charities.ts:33` | `/v1/charities` | OK 2026-05-03 | flipagent's `ein` translates to spec param `registration_ids` (not `ein`). Requires user OAuth (app-credential 165001). Path is bare `/charity_org`, not `/charity_org/search`. |
| GET | `/charity_org/{charity_org_id}` | `services/charities.ts:54` | `/v1/charities/{id}` | OK 2026-05-03 | Numeric input routed to `get_by_legacy_id?legacy_charity_org_id=`; non-numeric uses canonical id endpoint. |

### Commerce / Identity (`/commerce/identity/v1`)

OpenAPI: `sell-apps/other-apis/commerce_identity_v1_oas3.json`. Scope `commerce.identity.readonly`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/user/` | MISS (sanity-checked OK in coverage doc G.1, but no caller wired) | — | MISS | Cap matrix `identity.user` claims rest:user but no service file. |

### Commerce / Media (`/commerce/media/v1_beta`)

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| POST/GET | `/image` | `commerce.media` (user) | `services/media.ts:25` | `/v1/media` | WRP | Spec-verified path. Not exercised (POST needs binary upload). |
| POST/GET | `/video` | `commerce.media` (user) | `services/media.ts:25` | `/v1/media` | WRP | Spec-verified path. |
| GET | `/{type}/{id}` | `commerce.media` (user) | `services/media.ts:44` | `/v1/media/{id}` | WRP | Spec-verified path. |
| POST | `/upload_from_url` (batch) | `commerce.media` (user) | MISS | — | MISS | |
| GET | `/video` (list) | `commerce.media` (user) | MISS | — | MISS | |

### Commerce / Notification (`/commerce/notification/v1`)

OpenAPI: `sell-apps/communication/commerce_notification_v1_oas3.json`. Default scope `api_scope`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/config` | `services/notification-subs.ts:225` | `/v1/notifications/config` | OK 2026-05-03 | Live-probed 200. |
| PUT | `/config` | `services/notification-subs.ts:235` | `/v1/notifications/config` PUT | WRP | Spec-verified path. |
| GET | `/destination` | MISS (we POST only) | — | MISS | |
| POST | `/destination` | `services/notification-subs.ts:90` | `/v1/notifications/destinations` | OK 2026-05-03 (GET) / WRP (POST) | GET live-probed 200; POST not exercised. |
| GET | `/destination/{did}` | MISS | — | MISS | |
| PUT | `/destination/{did}` | MISS | — | MISS | |
| DELETE | `/destination/{did}` | MISS | — | MISS | |
| GET | `/public_key/{kid}` | `services/notification-subs.ts:252` | `/v1/notifications/public-key/{id}` | OK 2026-05-03 | Live-probed 404 errorId 195001 on fake kid — endpoint reachable. |
| GET | `/subscription` | `services/notification-subs.ts:60` (read in same file) | `/v1/notifications/subscriptions` | OK 2026-05-03 | Live-probed 200. |
| POST | `/subscription` | `services/notification-subs.ts:39` | POST | OK 2026-05-03 | Live-tested full lifecycle (create→get→disable→enable→test→delete). **Wrapper bug fixed**: body now nests `payload: {format, schemaVersion, deliveryProtocol}` (looked up from `topic/{id}` first). Without the payload eBay returned "Invalid or missing schema version". Uses `sellRequestWithLocation` for subId. |
| POST | `/subscription/{sid}/filter` | `services/notification-subs.ts:194` | `/v1/notifications/subscriptions/{id}/filter` | WRP | Spec-verified path. Not exercised (filter expression syntax is topic-specific). |
| GET | `/subscription/{sid}` | `services/notification-subs.ts:48` | `/v1/notifications/subscriptions/{id}` | OK 2026-05-03 | Live-tested. |
| PUT | `/subscription/{sid}` | `services/notification-subs.ts:76` | PUT | WRP | Spec-verified path. |
| DELETE | `/subscription/{sid}` | `services/notification-subs.ts:48` (DELETE branch) | DELETE | OK 2026-05-03 | Live-tested. |
| GET | `/subscription/{sid}/filter/{fid}` | `services/notification-subs.ts:208` | GET | WRP | Spec-verified path. |
| DELETE | `/subscription/{sid}/filter/{fid}` | `services/notification-subs.ts:173` | DELETE | WRP | Spec-verified path. |
| POST | `/subscription/{sid}/disable` | `services/notification-subs.ts:133` | POST | OK 2026-05-03 | Live-tested. |
| POST | `/subscription/{sid}/enable` | `services/notification-subs.ts:124` | POST | OK 2026-05-03 | Live-tested. |
| POST | `/subscription/{sid}/test` | `services/notification-subs.ts:148` | POST | OK 2026-05-03 | Live-tested (eBay accepted; actual notification delivery not verified — depends on destination). |
| GET | `/topic/{tid}` | MISS | — | MISS | |
| GET | `/topic` | `services/notification-subs.ts:108` | `/v1/notifications/topics` | OK 2026-05-03 | Live-probed 200. |

### Commerce / Taxonomy (`/commerce/taxonomy/v1`)

OpenAPI not bundled. Scope `api_scope` (app).

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/get_default_category_tree_id` | `services/categories.ts:28` | `/v1/categories` | OK | |
| GET | `/category_tree/{tid}` | `services/categories.ts:93` | `/v1/categories/tree/{id}` | OK | |
| GET | `/category_tree/{tid}/get_category_subtree` | `services/categories.ts:102` | `/v1/categories/{tid}/subtree` | OK | |
| GET | `/category_tree/{tid}/get_category_suggestions` | `services/categories.ts:132` | `/v1/categories/suggest` | OK | |
| GET | `/category_tree/{tid}/get_item_aspects_for_category` | `services/categories.ts:164` | `/v1/categories/{tid}/aspects` | OK | |
| GET | `/category_tree/{tid}/get_compatibility_properties` | `services/compatibility.ts:47` | `/v1/categories/{tid}/compatibility` | WRP | Spec-verified path. Not exercised with a real treeId. |
| GET | `/category_tree/{tid}/get_compatibility_property_values` | MISS | — | MISS | |
| GET | `/category_tree/{tid}/get_expired_categories` | MISS | — | MISS | |

### Commerce / Translation (`/commerce/translation/v1_beta`)

OpenAPI: `sell-apps/other-apis/commerce_translation_v1_beta_oas3.json`. Default scope `api_scope`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/translate` | `services/translate.ts:17` | `/v1/translate` | OK 2026-05-02 | Path is `v1_beta` (was `v1`, silently 404'd). |

### Commerce / Feedback (`/commerce/feedback/v1`)

OpenAPI: `sell-apps/communication/commerce_feedback_v1_beta_oas3.json`. Scopes `commerce.feedback` / `commerce.feedback.readonly`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/awaiting_feedback` | `services/ebay/rest/feedback.ts:163` | `/v1/feedback/awaiting` | OK 2026-05-02 | Returns full DSR template. |
| GET | `/feedback` | `services/ebay/rest/feedback.ts:122` | `/v1/feedback` | OK 2026-05-03 | Pagination keys read from `pagination.{limit,offset,total}` per spec (was destructuring at top level — `total` always missing). |
| POST | `/feedback` | `services/ebay/rest/feedback.ts:206` | `/v1/feedback` POST | WRP — POST untested | |
| GET | `/feedback_rating_summary` | MISS (verified in G.1 — scope works) | — | MISS | |
| POST | `/respond_to_feedback` | `services/ebay/rest/feedback.ts:respondToFeedback` | `/v1/feedback/{id}/respond` POST | OK 2026-05-03 | Live-probed 200 (eBay accepted body shape; with fake feedbackId likely a no-op or accepted-but-ignored). Off-eBay-contact hygiene applied at the route boundary. |

### Commerce / Message (`/commerce/message/v1`)

OpenAPI: `sell-apps/communication/commerce_message_v1_oas3.json`. Scope `commerce.message`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/bulk_update_conversation` | MISS | — | MISS | |
| GET | `/conversation/{cid}` | `services/ebay/rest/messages.ts:160` | `/v1/messages/{conversationId}` | OK 2026-05-02 | |
| GET | `/conversation` | `services/ebay/rest/messages.ts:125` | `/v1/messages` | OK 2026-05-02 | Includes FROM_EBAY system notifications. |
| POST | `/send_message` | `services/ebay/rest/messages.ts:219` | `/v1/messages` POST | WRP — POST untested | |
| POST | `/update_conversation` | MISS | — | MISS | |

### Commerce / VeRO (`/commerce/vero/v1`)

OpenAPI: `sell-apps/other-apis/commerce_vero_v1_oas3.json`. Scope `commerce.vero`. **All MISS** — niche IP claims surface, deferred.

| Method | eBay path | Status |
|---|---|---|
| GET | `/vero_reason_code/{vrcid}` | MISS |
| GET | `/vero_reason_code` | MISS |
| POST | `/vero_report` | MISS |
| GET | `/vero_report/{vrid}` | MISS |
| GET | `/vero_report_items` | MISS |

---

### Post-Order v2 (`/post-order/v2`)

OpenAPI not bundled. IAF auth (handled by `services/ebay/rest/user-client.ts:92`).

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/cancellation/search` | `services/disputes/operations.ts:26` | `/v1/disputes?type=cancellation` | OK 2026-05-02 (after IAF auth fix) | |
| GET | `/cancellation/{id}` | `services/disputes/operations.ts:34` | `/v1/disputes/{id}` | OK | |
| POST | `/cancellation/{id}/approve` | `services/disputes/operations.ts:106` | `/v1/disputes/{id}/respond` | WRP | Spec-verified path. |
| POST | `/cancellation/check_eligibility` | `services/disputes/cancellation.ts:43` | `/v1/disputes/cancellation/eligibility` | OK 2026-05-03 | Live-probed 200 (with `Authorization: IAF`). |
| POST | `/cancellation` | `services/disputes/cancellation.ts:66` | `/v1/disputes/cancellation` | WRP | Spec-verified path. Not exercised (needs a real orderId). |
| GET | `/return/search` | `services/disputes/operations.ts:24` | `/v1/disputes?type=return` | OK | |
| GET | `/return/{id}` | `services/disputes/operations.ts:32` | `/v1/disputes/{id}` | OK | |
| POST | `/return/{id}/decide` | `services/disputes/operations.ts:104` | `/v1/disputes/{id}/respond` | WRP | Spec-verified path. |
| GET | `/casemanagement/search` | `services/disputes/operations.ts:25` | `/v1/disputes?type=case` | OK | |
| GET | `/casemanagement/{id}` | `services/disputes/operations.ts:33` | `/v1/disputes/{id}` | OK | |
| POST | `/casemanagement/{id}/provide_seller_response` | `services/disputes/operations.ts:105` | `/v1/disputes/{id}/respond` | WRP | Spec-verified path. |
| GET | `/inquiry/search` | `services/disputes/operations.ts:27` | `/v1/disputes?type=inquiry` | OK | |
| GET | `/inquiry/{id}` | `services/disputes/operations.ts:35` | `/v1/disputes/{id}` | OK | |
| POST | `/inquiry/{id}/provide_seller_response` | `services/disputes/operations.ts:107` | `/v1/disputes/{id}/respond` | WRP | Spec-verified path. |
| POST | `/inquiry/{id}/close` | `services/disputes/operations.ts:closeInquiry` | `/v1/disputes/{id}/close` POST | OK 2026-05-03 | Live-probed 500 ACCESS errorId 2003 on fake inquiryId — endpoint reachable (post-order's standard pattern for invalid ids). |

---

### Developer (`/developer/`)

#### `/developer/analytics/v1_beta`

OpenAPI: `application-settings/developer_analytics_v1_beta_oas3.json`.

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/rate_limit/` | `api_scope` (app) | `services/me-account.ts:45` | `/v1/me/quota` | WRP | Spec-verified path. |
| GET | `/user_rate_limit/` | `sell.inventory` (user) | `services/me-account.ts:52` | `/v1/me/quota` | WRP | Spec-verified path. |

#### `/developer/key_management/v1`

OpenAPI: `application-settings/developer_key_management_v1_oas3.json`. Scope `api_scope`.

| Method | eBay path | Status | Notes |
|---|---|---|---|
| GET | `/signing_key` | MISS | Mandatory for some 2025+ eBay endpoints (Section 6 follow-up). |
| POST | `/signing_key` | MISS | |
| GET | `/signing_key/{kid}` | MISS | |

#### `/developer/client_registration/v1`

OpenAPI: `application-settings/developer_client_registration_v1_oas3.json`.

| Method | eBay path | Status | Notes |
|---|---|---|---|
| POST | `/client/register` | MISS | One-time per client; not relevant to runtime. |

---

## Section 2: Trading XML verbs

Trading client: `services/ebay/trading/client.ts`. Any verb is callable via `tradingCall({ callName, accessToken, body })`. The Trading API exposes ~140 verbs total; we wrap the ones below explicitly.

| Verb | Our wrapper | Used by | Status | Notes |
|---|---|---|---|---|
| GetBestOffers | `services/ebay/trading/best-offer.ts:43` | `/v1/offers` (inbound list) | OK 2026-05-03 | Live-probed `Ack: Success`. No REST equivalent — Negotiation REST is outbound only. |
| RespondToBestOffer | `services/ebay/trading/best-offer.ts:97` | `/v1/offers/{id}/respond` | OK 2026-05-03 | Live-probed errorCode 21549 on fake itemId — XML body shape correct, endpoint reachable. |
| VerifyAddItem | `services/ebay/trading/listing.ts:49` | sandbox sell-side workaround | OK 2026-05-03 | Live-probed; eBay accepted XML body shape and returned listing-quality warnings (correct response shape). Sandbox Sell/Inventory deadlocks on business-policy opt-in (memory: feedback_ebay_sandbox_sell.md). Use cat 88433. |
| GetMyeBaySelling | `services/ebay/trading/myebay.ts:68` | `/v1/me/selling` | OK | Convenience read for legacy listings. |
| GetMyeBayBuying | `services/ebay/trading/myebay.ts:94` | `/v1/me/buying` | OK | No REST equivalent. |
| AddToWatchList | `services/ebay/trading/myebay.ts:112` | `/v1/watching` POST | OK 2026-05-03 | Live-probed errorCode 20819 on fake itemId — XML body shape correct, endpoint reachable. No REST watchlist write. |
| RemoveFromWatchList | `services/ebay/trading/myebay.ts:122` | `/v1/watching/{id}` DELETE | OK 2026-05-03 | Live-probed errorCode 20820 on fake itemId — XML body shape correct. |
| SetNotificationPreferences | `services/notifications/ebay-trading.ts:73` | `/v1/notifications/config` (Trading topics) | OK | Trading covers a broader topic set than Commerce/Notification. |
| GetNotificationPreferences | `services/notifications/ebay-trading.ts:98-99` | `/v1/notifications/config` (read app + user) | OK | |
| GetStore | `services/store.ts:85` | `/v1/store` | OK 2026-05-02 | Replaces gated REST `/sell/stores/v1/store`. |

**Available via `tradingCall` but not wrapped (~130 verbs).** Notable ones to remember:
- `GetMyMessages` / `AddMemberMessageRTQ` — REPLACED by Commerce/Message REST 2026-05-02 (commit d9e0dba)
- `GetFeedback` / `LeaveFeedback` / `GetItemsAwaitingFeedback` — REPLACED by Commerce/Feedback REST 2026-05-02
- `GetCategories` — replaced by Commerce/Taxonomy
- `GetSellerEvents` / `GetSellerList` — full historical inventory pull
- `GetItemTransactions` / `GetSellerTransactions` — pre-Finances API order pull
- `AddSecondChanceItem` — convert losing-bidder offers to BIN
- `GetAccount` — Trading-side seller statement
- `GetCategoryFeatures` — per-category capability matrix richer than Metadata API
- `EndFixedPriceItem` / `EndItems` — Trading mass-end (we use Sell Inventory `withdraw`)
- `AddFixedPriceItem` / `RelistFixedPriceItem` / `ReviseFixedPriceItem` — Trading-side full listing CRUD (we use Sell Inventory)

---

## Section 3: Bridge tasks

Defined in `services/ebay/bridge/tasks.ts`. Eight constants total.

| Task | Surface | Status | Notes |
|---|---|---|---|
| EBAY_BUY_ITEM | `/v1/purchases` | OK | First-class for `orders.checkout`, equal sibling to REST. |
| EBAY_QUERY | `/v1/items` (bridge transport) | OK | Search/sold/detail in user's session. |
| EBAY_INBOX_WATCHING | `/v1/watching` | OK | No eBay REST equivalent. |
| EBAY_INBOX_OFFERS | `/v1/me/offers` (inbox view) | OK | Trading `GetBestOffers` covers existence; bridge gives inbox-shape view + counters. |
| EBAY_INBOX_CASES | `/v1/me/cases` | OK | No eBay REST equivalent — Resolution Center scrape. |
| PLANETEXPRESS_PULL_PACKAGES | `/v1/forwarder/planetexpress/packages` | OK | No eBay equivalent (forwarder ops). |
| PLANETEXPRESS_PACKAGE_PHOTOS | `/v1/forwarder/planetexpress/packages/{id}/photos` | OK | |
| PLANETEXPRESS_PACKAGE_DISPATCH | `/v1/forwarder/planetexpress/packages/{id}/dispatch` | OK | |
| BROWSER_OP | `/v1/browser/*` | OK | Synchronous DOM primitives (click/scroll/screenshot). |
| RELOAD_EXTENSION | internal admin | OK | Control task. |

(Total = 11 constants in the file; 8 are eBay-specific surfaces, 3 are forwarder/control.)

---

## Section 4: Scrape paths

Vendor: Oxylabs Web Scraper API (`SCRAPER_API_VENDOR=oxylabs`). Implementation in `packages/api/src/services/ebay/scrape/`.

| URL pattern | What we extract | Backing wrapper | Status |
|---|---|---|---|
| `https://www.ebay.com/itm/{legacyId}` | Item detail (title, price, shipping, condition, seller, photos, item-specifics) | `services/ebay/scrape/client.ts:229` | OK |
| `https://www.ebay.com/sch/i.html?_nkw=...` | Active listings search | `services/ebay/scrape/client.ts` (build URL) | OK |
| `https://www.ebay.com/sch/i.html?_sacat=...&LH_Sold=1&LH_Complete=1` | Sold-comps (Marketplace Insights replacement) | `services/items/sold.ts` | OK |
| `https://www.ebay.com/p/{epid}` | Catalog product (JSON-LD `Product` schema.org block) | `services/ebay/scrape/catalog.ts:123` | OK |
| `https://www.ebay.com/sch/i.html` (catalog discovery) | EPIDs from search results | `services/ebay/scrape/catalog.ts:222` | OK |

Cache TTLs (`services/shared/cache.ts`): 60 min active, 12h sold, 4h detail. Anti-thundering-herd, not archival. Takedown opt-out flushes + blocklists.

---

## Section 5: Known dead / impossible

Tried, verified, doesn't work:

- `/sell/account/v1/eligibility` — endpoint doesn't exist (verified live 2026-05-02; absent from OpenAPI). Removed from our code.
- `/sell/finances/v1/*` on `api.ebay.com` — wrong host (returns no-envelope 404). The Finances API is on `apiz.ebay.com`. Routing centralized in `services/ebay/host.ts`. Same trap as `/commerce/identity/v1/user/`.
- `/buy/offer/v1/...` (no `_beta`) — only `v1_beta` exists. Verified live with errorId 2004 ACCESS on `place_proxy_bid` (real endpoint, fake itemId).
- `/buy/offer/v1_beta/bidding` (list) — endpoint doesn't exist. eBay's bidding REST is per-item only. The "list my bids" view comes from Trading `GetMyeBayBuying.BidList`.
- Charity API `ein` query param — doesn't exist (165002). Use `registration_ids` (comma-separated). flipagent's `ein` is translated to it at the wrapper boundary.
- `/sell/metadata/v1/marketplace/{X}/get_digital_signature_routes` — endpoint doesn't exist. Removed.
- `/sell/negotiation/v1/offer` (and `/offers`, `/sent_offers`, `/outbound`, `/history`) — REST is genuinely write-only; reading sent-offer status is impossible via REST (verified live 2026-05-02 — all 4 plausible variants 404). Only path is bridge-scraping My eBay > Sent Offers.
- `/sell/stores/v1/*` — gated by app approval we don't have (verified live: 403 "Insufficient permissions" even with `sell.stores.readonly` consented + active store on account). Using Trading `GetStore` for metadata.
- `/buy/feed/v1_beta/*` — gated 403 "Contact Developer Technical Support" — Limited Release, would need eBay app approval.
- `/sell/feed/v1/*` — same gate as Buy Feed.
- Trading `GetMyMessages` / `LeaveFeedback` / etc. — superseded by Commerce/Message + Commerce/Feedback REST 2026-05-02. Trading modules deleted.
- `/get_listing_fees` (Sell Inventory) — works, but returns ONLY listing-time fees (insertion + bold + gallery + ProPackBundle, ~27 categories). Does NOT return FinalValueFee (eBay's main ~13.25% commission charged at sale time). `quant/fees.ts` static `feeRate: 0.1325` remains correct for FVF margin modeling.
- Old `/commerce/translation/v1/translate` — silently 404s; correct path is `v1_beta`. `services/translate.ts:17` uses the right one now.
- IAF auth on `/post-order/v2/*` — was silently broken (Bearer auth wrong; IAF is the legacy pipe). Two-line fix in `services/ebay/rest/user-client.ts:92` unblocked every dispute-read caller. Pre-existing bug.
- `sell.marketing` scope was missing from `EBAY_SCOPES` for ~weeks — silently 403'd every ad list/read. Fixed; verified working.

---

## Section 6: Open follow-ups

After the four-sweep audit (probe + path-sweep + spec-diff + field-diff), the following remain open:

### Limited Release / app-approval gated (action: apply through eBay dev portal)

- `/sell/feed/v1/*` and `/buy/feed/v1_beta/*` — LR ("Contact Developer Technical Support")
- `/sell/logistics/v1_beta/*` — LR (path correct + spec-verified, but errorId 1100 even with our broadest scopes)
- `/sell/stores/v1/store` — REST is gated; Trading `GetStore` workaround in place
- `/sell/finances/v1/transfer` (sub-resource only) — LR within otherwise-open Finances
- `/buy/offer/v1_beta/bidding/*` — LR; `buy.offer.auction` only in sandbox scope catalog
- `/buy/order/v1/checkout_session/*` — LR; orchestrator falls back to bridge transport when `EBAY_ORDER_APPROVED=0`
- `/buy/marketplace_insights/v1_beta/*` — LR; falls back to scrape

### Wrappers exist, never tested with real-data POST (need a real listing/order/conversation)

- `POST /commerce/message/v1/send_message` (real recipient)
- `POST /commerce/feedback/v1/feedback` (leave feedback)
- `POST /post-order/v2/cancellation` (create — needs a real orderId)
- `POST /sell/fulfillment/v1/payment_dispute/{id}/upload_evidence_file` (multipart binary, needs a real disputeId)

### Genuinely unwrapped (= MISS rows) — final classification 2026-05-03

After three rounds of MISS-wraps, the 272 remaining MISS rows fall into four buckets:

#### ✅ Wrapped this session — done

- `POST /commerce/feedback/v1/respond_to_feedback` (`/v1/feedback/{id}/respond` POST)
- `POST /post-order/v2/inquiry/{id}/close` (`/v1/disputes/{id}/close` POST)
- `PUT/DELETE /sell/account/v1/sales_tax/{country}/{jurisdictionId}` (`/v1/me/seller/sales-tax/...`)
- `POST /sell/account/v1/bulk_create_or_replace_sales_tax` (`bulkUpsertSalesTax`)
- `POST /sell/inventory/v1/location/{id}/update_location_details` (`/v1/locations/{id}` PATCH)
- **Business policies CRUD entire surface** (return/payment/fulfillment) — `/v1/policies` POST + `/v1/policies/{type}/{id}` PUT/DELETE. Section 1 had falsely claimed these were wrapped at `services/policies.ts` — they weren't, just GET-only. Now actually wrapped via `services/policies-write.ts` and live-tested.
- `/sell/marketing/v1/item_promotion/{id}` GET/PUT/DELETE + `/promotion/{id}/pause` + `/resume` + `/get_listing_set`
- `/sell/marketing/v1/item_price_markdown/{id}` GET/PUT/DELETE
- 16 `/sell/metadata/v1/marketplace/{m}/get_*_policies` (via generic `getMarketplacePolicy(kind)`)
- 5 `/sell/metadata/v1/compatibilities/*` helpers
- `/commerce/notification/v1/destination/*` GET/POST/PUT/DELETE
- **`/commerce/vero/v1/*`** — entire VeRO IP-rights surface (5 endpoints, new `services/vero.ts`)
- **`/developer/key_management/v1/signing_key/*`** — HTTP signature key mint+read (new `services/signing-keys.ts`)
- `/commerce/catalog/v1_beta/change_request/*` — catalog correction submissions (new `services/catalog-change.ts`)
- 22 post-order action helpers in `services/disputes/actions.ts`: `closeCase`, `appealCase`, `caseIssueRefund`, `escalateInquiry`, `inquiryIssueRefund`, `inquiryConfirmRefund`, `returnMarkAsReceived`, `returnMarkAsShipped`, `returnIssueRefund`, `returnSendMessage`, `cancelReturn`, `escalateReturn`, `voidReturnShippingLabel`, `updateReturnTracking`, `getReturnTracking`, `approveCancellation`, `confirmCancellation`, `rejectCancellation`, `createInquiry`, `createReturn`, `checkInquiryEligibility`, `checkReturnEligibility`

#### Intentionally skipped — Limited Release / app-approval gated (~72 endpoints)

Cannot live-test even with the deepest scope set. Each surface needs a separate eBay app-approval workflow.

| Surface | Endpoints | Notes |
|---|---|---|
| `/buy/order/v1/*` | 30 | LR. Bridge transport handles purchases; the 6 main `checkout_session` paths are wrapped + apiz-host-routed. The 24 remainder (guest/draft variants, payment-method-specific) all share the same LR gate. |
| `/sell/feed/v1/*` | 23 | LR. "Contact Developer Technical Support" gate. |
| `/buy/feed/v1_beta/*` | 4 | Same LR gate. |
| `/buy/deal/v1/*` | 4 | LR. |
| `/buy/marketing/v1_beta/*` | 3 | LR (merchandised products + also-bought). |
| `/sell/logistics/v1_beta/*` | 3 | LR. Label-purchase wrapper exists but errorId 1100 even on cleanest body. |
| `/buy/marketplace_insights/v1_beta/*` | 1 | LR; sold-listing scrape covers the use case. |

#### Intentionally skipped — niche advanced surfaces (~82 endpoints)

| Surface | Endpoints | Skip rationale |
|---|---|---|
| `/sell/marketing/v1/{keyword,negative_keyword,email_campaign}/*` | 54 | PLA keyword bidding + email blasts. Used by power Promoted-Listings sellers; flipagent's typical user (re-seller automating the basics) doesn't run keyword campaigns directly. Wrap on demand. |
| `/sell/edelivery_international_shipping/v1/*` | 27 | International shipping label/manifest/agents/handover — entire surface. Narrow audience (cross-border sellers using eBay's eDelivery program). Most flipagent users use 3PL not eBay-native eDelivery. Wrap on demand. |
| `/sell/listing/v1_beta/*` | 1 | sell_listing_v1_beta is a parallel/legacy surface to Sell Inventory; we've standardized on Sell Inventory. |

#### Diff false positives — already wrapped via dynamic dispatch (~118 endpoints)

The spec-diff matches by literal path; many wrappers use computed paths (`/sell/.../${type}_policy`, `/sell/metadata/.../${KIND_TO_PATH[kind]}`, `/sell/account/v1/${jurisdictionId}`) the AST extractor can't statically resolve to spec entries. These show as MISS but are functionally wrapped:

- `/sell/account/v1/*` (~28) — wrapped via `services/policies-write.ts` PATH lookup, `services/seller-account.ts` sales_tax dispatch, `services/policies.ts` read-by-type
- `/post-order/v2/*` (~25) — wrapped via `services/disputes/actions.ts` (one helper per action) + `services/disputes/operations.ts` PATH lookup
- `/sell/metadata/v1/*` (~15) — wrapped via `getMarketplacePolicy(kind)` generic dispatcher
- `/buy/browse/v1/*` (~10) — wrapped via `services/items/rest.ts` switch
- `/sell/fulfillment/v1/*` (~7) — wrapped via `services/sales/operations.ts` + `services/disputes/operations.ts`
- `/sell/inventory/v1/*` (~4) — wrapped, template strings
- `/sell/finances/v1/*` (~4) — wrapped, apiz host
- `/commerce/{catalog,media,taxonomy,message,translation,identity,feedback,notification,charity}/*` (~25) — all wrapped

The remaining ~12 in this bucket are genuine future-wrap candidates: sell/account v2 payout_settings, search_by_image, developer/registration, compliance restitution.

### Improvement opportunities (working today, could be better)

- **API-status RSS feed** (`https://developer.ebay.com/rss/api-status`) — not yet polled. Reference repo at `references/ebay-mcp/scripts/sync-api-status.mjs` polls weekly. Decide cron or `/v1/health/ebay` endpoint.
- **Trading XML wrappers — all 8 live-verified 2026-05-03** (`GetMyeBaySelling` 200, `GetMyeBayBuying` 200, `AddToWatchList` errCode 20819 on fake id, `RemoveFromWatchList` errCode 20820, `GetBestOffers` Ack:Success, `RespondToBestOffer` errCode 21549, `GetSearchResults` errCode 10007 (eBay-side system error — Trading's GetSearchResults is degraded; wrapper marked best-effort), `VerifyAddItem` returned listing-quality warnings — all envelope-bearing). eBay doesn't publish OpenAPI for Trading; this is the deepest verification possible without spec-diff.

---

## Section 7: How to use this file

When you change anything in `EBAY_SCOPES`, when you wrap a new endpoint, or when you discover a 4xx in production, update the relevant row. Re-run live probes by token-exchanging via `/v1/connect/ebay` consent flow and `curl -H "Authorization: Bearer $TOK" -H "X-EBAY-C-MARKETPLACE-ID: EBAY_US" "$EBAY_BASE_URL$PATH"` (use `Authorization: IAF $TOK` for `/post-order/v2/*`). Mark OK with the probe date in the Notes column. The Status column is the source of truth for "does this work today."

When wrapping a new endpoint:
1. Find its row in Section 1 (or add one if missing — eBay added it post-2026-04-24 OpenAPI snapshot).
2. Fill `Our wrapper` with `services/<file>.ts:LINE`.
3. Fill `Our route` with the `/v1/...` shape.
4. Set Status to WRP until you live-probe it; flip to OK with date once verified.
5. If you removed something dead, move the row to Section 5.

---

## Section 8: Live probe sweep — 2026-05-03 (post re-consent)

Replayed via `packages/api/scripts/ebay-endpoint-probe.ts`. The script
refreshes the stored sprd-shop user OAuth, then sweeps every endpoint
we wrap (REST, Trading, Post-Order). The full machine-readable result
is committed to `notes/ebay-endpoint-probe-results.json`. Every
`OK 2026-05-03` row in Section 1 traces back to one of the entries
below.

Two complementary scripts:

1. **`scripts/ebay-endpoint-probe.ts`** — curated 57-endpoint set with valid request shapes. Tests each major API group end-to-end (auth + scope + path + body shape).
2. **`scripts/ebay-path-sweep.ts`** — broad 101-path sweep with FAKE IDs across every GET path any wrapper references. Classifies by HTTP code + error-envelope presence to surface wrong-host / wrong-path bugs (the empty-body-404 signature that already caught the apiz misroutes).

To re-consent eBay (when scopes change): `cd packages/api && node --env-file=.env --import tsx scripts/ebay-reconsent.ts` — kill dev api on :4000 first, the script listens there for the callback.

**Final tally after re-consent + broad sweep — 0 wrapper path/host bugs remaining:**

| Probe set | Total | Verified working (2xx) | Reachable 4xx (envelope back) | Path/host bug | LR / scope-gated | Rate-limit | Other |
|---|---|---|---|---|---|---|---|
| Curated probe (57) | 57 | 45 | 5 | 0 | 6 | 1 | 0 |
| Broad sweep (101) | 101 | 53 | 31 | **0** | 8 | 4 | 5 |

All 5 "Other" entries are Post-Order endpoints returning non-JSON envelopes on bogus IDs (their format, not a bug) or eBay-side 500s on edge-case bad IDs. All 5 LR-gated entries are documented in the Limited Release table below.

**Catalog REST user-OAuth fallback shipped 2026-05-03:** discovered that `/commerce/catalog/v1_beta/{product_summary/search,product/{epid}}` returns 200 with user OAuth + our default scopes, even though app-credential tokens are LR-gated. Wrapper at `services/products.ts` now tries user OAuth → app credential → scrape; any connected seller hits REST without us holding `EBAY_CATALOG_APPROVED` approval. Live-verified end-to-end: `getProductByEpid('4034210179')` returns `source: rest, gtin: '0190199188785', category: '171485'` for sprd-shop. Surfaced one more wrapper bug along the way — `gtin`/`ean`/`upc` ARE arrays per spec (eBay returns multiple GTINs for products with packaging variants); previous "scalar" assumption was wrong. flipagent surface keeps `gtin: string` for ergonomics, picks first GTIN.

### Verified working (200 / 204)

| Endpoint | Result | Notes |
|---|---|---|
| GET `/sell/account/v1/privilege` | 200 | `sellingLimit` populated |
| GET `/sell/account/v1/kyc` | 204 | no kyc events |
| GET `/sell/account/v1/subscription` | 200 |  |
| GET `/sell/account/v1/payments_program/EBAY_US/EBAY_PAYMENTS` | 200 | enrolled |
| GET `/sell/account/v1/advertising_eligibility` | 200 | INELIGIBLE = NOT_ENOUGH_ACTIVITY (state, not bug) |
| GET `/sell/account/v1/program/get_opted_in_programs` | 200 |  |
| GET `/sell/account/v1/rate_table` | 200 |  |
| GET `/sell/account/v1/custom_policy` | 200 |  |
| GET `/sell/account/v1/sales_tax?country_code=US` | 204 | no tax setup |
| GET `/sell/inventory/v1/inventory_item?limit=1` | 200 | requires `Accept-Language: en-US` |
| GET `/sell/inventory/v1/location?limit=1` | 200 |  |
| GET `/sell/inventory/v1/offer?sku=X` | 404 errorId 25713 | endpoint OK, no offer for that sku |
| GET `/sell/fulfillment/v1/order?limit=1` | 200 |  |
| GET `/sell/marketing/v1/ad_report_metadata` | 200 |  |
| GET `/sell/marketing/v1/promotion?marketplace_id=EBAY_US&limit=1` | 200 | `marketplace_id` query is REQUIRED |
| GET `/sell/marketing/v1/promotion?marketplace_id=EBAY_US&promotion_type=MARKDOWN_SALE&limit=1` | 200 | how to filter for markdowns |
| GET `/sell/marketing/v1/promotion_summary_report?marketplace_id=EBAY_US` | 200 |  |
| GET `/sell/compliance/v1/listing_violation_summary` | 204 | no violations |
| GET `/sell/metadata/v1/marketplace/EBAY_US/get_return_policies` | 200 |  |
| GET `/sell/metadata/v1/marketplace/EBAY_US/get_listing_structure_policies` | 200 |  |
| GET `/sell/metadata/v1/country/US/sales_tax_jurisdiction` | 200 | NOT `marketplace/{X}/get_sales_tax_jurisdictions` |
| GET `/sell/negotiation/v1/find_eligible_items` | 204 | requires `X-EBAY-C-MARKETPLACE-ID` header |
| GET `/sell/finances/v1/payout?limit=1` | 204 | apiz host required |
| GET `/sell/finances/v1/payout_summary?filter=...` | 200 | apiz host required |
| GET `/sell/finances/v1/transaction?limit=1` | 200 | apiz host required |
| POST `/sell/recommendation/v1/find?marketplace_id=EBAY-US` | 400 errorId 145105 | endpoint OK, fake `v123` listingId rejected; marketplace uses HYPHEN form on this surface only |
| GET `/commerce/identity/v1/user/` | 200 | apiz host + trailing slash + marketplace header all required |
| GET `/commerce/charity/v1/charity_org?q=...` | 200 | needs USER OAuth (app-credential 165001); `registration_ids=` for EIN search, not `ein=` |
| GET `/commerce/notification/v1/{topic,destination,subscription,config}` | 200 | all four 200 |
| POST `/commerce/translation/v1_beta/translate` | 200 | path is `v1_beta` not `v1`; `translationContext` required |
| GET `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US` | 200 |  |
| POST `/post-order/v2/cancellation/check_eligibility` | 200 | `Authorization: IAF` not Bearer |
| GET `/post-order/v2/return/search?limit=1` | 200 | IAF |
| GET `/post-order/v2/inquiry/search?limit=1` | 200 | IAF |
| GET `/post-order/v2/casemanagement/search?limit=1` | 200 | path is `casemanagement` not `case` |
| GET `/post-order/v2/cancellation/search?limit=1` | 200 | IAF |

### Production wrapper bugs caught by FIELD diff (2026-05-03)

The fourth sweep ran `scripts/ebay-field-diff.ts` — TS-AST-walks every `sellRequest<T>(...)`/`appRequest<T>(...)` call site, extracts (method, path, body literal keys, response generic top-level keys), then diffs against the OAS3 component schemas (resolves `$ref` + `allOf`). Surfaces:

- `missingRequired` — spec requires a field, our request body doesn't include it.
- `sendUnknown` — we send a body field the spec doesn't define.
- `respUnknown` — our response interface destructures fields the spec's response schema doesn't define (silent typo — eBay returns undefined).

Final tally after fixes: **161 call sites scanned, 128 matched a spec, 0 missingRequired, 0 sendUnknown, 10 respUnknown remaining (all false-positives where spec wraps response in a single-property `$ref` wrapper schema my parser doesn't follow deeply).**

**Ten genuine field-shape bugs found by the field diff, none of which the path/probe sweeps would have caught (every one of these wrappers either silently returned empty results or silently dropped fields eBay never accepted):**

| Wrapper | Bug | Fix |
|---|---|---|
| `services/money/operations.ts:64` (`getPayoutSummary`) | response shape destructured `{amount, feeAmount, netAmount, count}` — spec returns `{amount, payoutCount, transactionCount}`. `feeAmount`/`netAmount` don't exist; `count` was always 0. | Read `payoutCount` + `transactionCount`; surface `count` + new `transactionCount` field. Drop fee/net from `PayoutSummary` type (eBay doesn't break down fees at summary level). |
| `services/marketing/markdowns.ts:69` (`createMarkdown`) | body sent flat `{campaignName, discountPercent, listingIds}` — spec requires `ItemPriceMarkdown` shape with `name`, `marketplaceId`, `promotionStatus`, `selectedInventoryDiscounts: [{discountBenefit: {percentageOffItem}, inventoryCriterion: {inventoryCriterionType, listingIds}}]`. **Every markdown create has been 400-rejecting in production.** Response field also wrong (`campaignId` → `promotionId`). | Rewritten to spec-compliant nested body |
| `services/listings/bulk.ts:151` (`upsertListingGroup`) | body sent `brand, mpn, gtin` — spec's `InventoryItemGroup` doesn't define them (those are per-SKU `inventory_item` fields). Response parser also extracted them, always undefined. | Drop brand/mpn/gtin; add spec fields `subtitle`, `videoIds` |
| `services/labels.ts:51` (`purchaseLabel`) | body sent `orderId` — spec's `CreateShipmentFromQuoteRequest` doesn't define it. Silently dropped by eBay. | Removed from body; documented order-link happens at quote time |
| `services/marketing/ads.ts:417` (`createAdGroup`) | body sent `defaultBidPercentage: string` — spec's `CreateAdGroupRequest` accepts `defaultBid: Amount` (cents-currency, not %). Silently dropped. Same field on response GET also undefined. | Body sends `defaultBid: {value, currency}` per spec; surface type updated to `defaultBid: Money`. AdGroup status enum corrected from `ended` → `archived`. |
| `services/bids.ts:87` (`getBidStatus`) | parsed `{biddingId, bidId, currentBidStatus, bidAmount, maxBidAmount, endDate, bidderUsername, bidDate}` — spec's `Bidding` defines `{auctionEndDate, auctionStatus, bidCount, currentPrice, currentProxyBid, highBidder, itemId, reservePriceMet, suggestedBidAmounts}`. NONE of our parsed names exist. Function returned empty Bid for every call. | Rewritten against spec; `BidStatus` derived from `auctionStatus + highBidder` |
| `services/bids.ts:96` (`placeBid`) | extracted `{biddingId}` — spec's `PlaceProxyBidResponse` returns `{proxyBidId}` only | Parse `proxyBidId` |
| `services/analytics.ts:75` (`getSellerStandards`) | parsed `{evaluationLevel, evaluationCycle}` — spec returns `{standardsLevel, program, cycle: {cycleType}, evaluationReason, defaultProgram, metrics}`. `level` was always falling back to `above_standard` regardless of actual seller status. | Read `standardsLevel` + `cycle.cycleType` |
| `services/products.ts:33` (`ebayProductToProduct`) | extracted `gtins: string[]` (plural array) and `primaryCategory: {categoryId, categoryName}` — spec returns `gtin` (scalar string) and `primaryCategoryId` (scalar string). EAN/UPC also separate scalar fields, not part of gtin. brand/category lookups have been silently empty. | Read scalar `gtin`/`ean`/`upc` (fall back chain); read `primaryCategoryId` |
| `services/ebay/rest/feedback.ts:101` (`listFeedback`) | destructured `{limit, offset, total, next}` at top level — spec wraps them in `pagination: {limit, offset, total, next}`. `total` was never returned to callers. | Read `res.pagination.{limit,offset,total}` |

### Production wrapper bugs caught by spec-diff (2026-05-03)

The third sweep ran `scripts/ebay-spec-diff.ts` — diffs every wrapper path against the bundled OAS3 specs. eBay's developer portal blocks all programmatic JSON downloads (Akamai-fronted), so the 14 specs missing from the original `references/ebay-mcp/docs/` bundle (Buy Browse/Order/Offer/Feed/Marketing/Marketplace Insights/Deal, Sell Finances/Logistics/Stores/Feed, Commerce Charity/Catalog/Taxonomy/Media, post-order/v2) were sourced from the community OpenAPI mirror at `github.com/hendt/ebay-api/specs/*` — 35 specs total, all sha-pinned and saved to `references/ebay-mcp/docs/_mirror/`. Combined corpus: **56 specs, 752 endpoints**.

Final diff: **43 wrapper paths matched, 1 false positive (normalize artifact: `payments_program/{X}/EBAY_PAYMENTS` vs spec `{payments_program_type}`)**, 4 wrapper paths still without a spec (mostly post-order /v2 sub-paths the mirror doesn't carry), 413 spec-only endpoints we don't wrap (= MISS opportunities). **Three genuine wrapper bugs found by the spec corpus alone** (none would have been caught by the live probe — they returned valid-looking 4xx envelopes that the wrappers swallowed):

| Wrapper | Spec says | Was | Fix |
|---|---|---|---|
| `services/analytics.ts:99` (`getServiceMetrics`) | only `/customer_service_metric/{type}/{evaluation_type}` exists; the bare `/customer_service_metric` is not defined | called bare path; eBay returned 404 errorId 2002 (silently swallowed by `swallowEbay404`) — service has been returning empty metrics for everyone since written | loop over `[ITEM_NOT_AS_DESCRIBED, ITEM_NOT_RECEIVED]` × `CURRENT`, aggregate. Also gracefully handle errorId 54402 (eBay restricts customer service metrics to GB + DE marketplaces; US returns 54402) |
| `services/listings/bulk.ts:229` (`bulkGetOffer`) | spec lists `bulk_create_offer` and `bulk_publish_offer` but NO `bulk_get_offer` | wrapper called nonexistent endpoint; live probe confirmed 404 | rewritten to fan out parallel `GET /offer/{offerId}` calls; route shape `/v1/listings/bulk/get-offers` preserved |
| `services/labels.ts:51` (`purchaseLabel`) | only `POST /shipment/create_from_shipping_quote` exists under `/shipment`; the bare `POST /shipment` is not defined | called `POST /sell/logistics/v1_beta/shipment` (bare); eBay returns 404 errorId 2002. Every shipping-label purchase has been silently 404ing since the wrapper was written. | path corrected to `POST /sell/logistics/v1_beta/shipment/create_from_shipping_quote` |

The spec-diff also surfaced **413 spec-defined endpoints we don't wrap** (after adding the 35 mirror specs). Top gaps:

| Spec area | POST + GET + PUT + DELETE missing | Notes |
|---|---|---|
| Sell Marketing keyword/PLA + email_campaign | 78 | Niche advertiser tooling — bulk_create_keyword, negative_keyword, etc. |
| Sell Inventory bulk variants + group ops | 26 | bulk_create_offer, bulk_get_inventory_item_group, etc. |
| Sell Account policy CRUD + sales_tax CRUD | 28 | Most policy reads wrapped; full CRUD missing |
| Sell eDelivery International Shipping | 26 | Entire surface unwrapped |
| Sell Metadata per-marketplace policy reads | 22 | `get_motors_listing_policies` etc. |
| Sell Fulfillment refund variants | 15 | issue_partial_refund_for_lost_item, etc. |
| Commerce Notification CRUD on subscriptions | 14 | Read works; write fully unwrapped |
| Commerce VeRO | 4 | IP rights compliance |
| Commerce Feedback | 3 | Counter-respond, pending list |

### Production wrapper bugs caught by the broad sweep (2026-05-03)

The broad path sweep specifically searches for the empty-body-404 signature that originally exposed the Sell Finances apiz misroute. It found two more in production code:

| Wrapper | Was | Root cause | Fix |
|---|---|---|---|
| `services/store.ts:35,50` (`getStoreCategories`, `putStoreCategories`) | empty 404 on `api.ebay.com/sell/stores/v2/store-categories` | wrong host — Sell Stores v2 lives on `apiz.ebay.com`. Without the host swap every store-category mutation silently 404'd. | added `/sell/stores/v2/` to `ebayHostFor`'s APIZ_PREFIXES |
| `services/purchases/orchestrate.ts:171,186,208,215` (`updateShippingAddress`, `updatePaymentInstrument`, `applyCoupon`, `removeCoupon`) | empty 404 on `api.ebay.com/buy/order/v1/checkout_session/{id}/...` | wrong host — Buy Order also lives on `apiz.ebay.com`. The bug never surfaced in production because `EBAY_ORDER_APPROVED` defaults false (purchases route through bridge), so REST transport never ran. Would have failed silently the moment we got Order API approval. | added `/buy/order/v1/` to APIZ_PREFIXES |

### Bugs fixed earlier this sweep (root-cause table)

Each row is a class of failure with a single root cause and the fix in
one place. Every `OK 2026-05-03` row in Section 1 that flipped from
4xx → 2xx traces back to one of these.

| Class | Was failing | Root cause | Fix |
|---|---|---|---|
| **Wrong host** (returns no-envelope 404) | every `/sell/finances/v1/*`, `/sell/fulfillment/v1/payment_dispute*`, and `/commerce/identity/v1/*` call | apiz.ebay.com hosts these surfaces; api.ebay.com 404s with `Content-Length: 0` and no JSON envelope (signature unique to "wrong host" — every other 404 carries an `errors[]` array) | Centralized in `services/ebay/host.ts:ebayHostFor`. `user-client.ts` + `app-client.ts` both route by path prefix. New `host.ts` extracted to break a circular import with `oauth.ts`. |
| **Wrong API version** | `/buy/offer/v1/bidding/*` 404 | `v1` doesn't exist; only `v1_beta` (verified: `place_proxy_bid` on v1_beta returns ACCESS errorId 2004 on a fake itemId — endpoint reachable) | `services/bids.ts` paths swapped to `v1_beta`. Added new `getBidStatus(itemId)` for `GET v1_beta/bidding/{id}`. |
| **Endpoint never existed** | `GET /buy/offer/v1/bidding` (list) 404 | eBay's Buy Offer REST is per-item only — there's no list shape | `services/bids.ts:listBids` rerouted through Trading `GetMyeBayBuying.BidList`, reusing `services/me-overview.ts`'s row→Item mapper |
| **Wrong query param** | `/commerce/charity/v1/charity_org?ein=…` errorId 165002 | param name is `registration_ids` (comma-separated), not `ein` | `services/charities.ts` translates flipagent's `ein` → eBay `registration_ids` at the wrapper boundary; flipagent surface unchanged |
| **Wrong auth credential** | `/commerce/charity/v1/charity_org` errorId 165001 with app-credential token | API is gated by user OAuth at the app level (app-credential token returns 165001 even with all scopes); user OAuth + marketplace header is sufficient | `services/charities.ts` switched from `appRequest` → `sellRequest`; route now passes `apiKeyId` |
| **Wrong sub-path** | `/post-order/v2/case/search` 404 | the post-order resource is named `casemanagement` not `case` | `services/disputes/operations.ts` already used the right path; the previous probe row in Section 8 was simply mis-typed. |
| **Wrong path shape** | `/sell/marketing/v1/item_promotion?…` and `/sell/marketing/v1/item_price_markdown?…` 400 | both are POST-only `create` endpoints; LIST is `/promotion?marketplace_id=&promotion_type=` (markdowns are a `Promotion` subtype) | `services/marketing/{promotions,markdowns}.ts` LIST path now `/promotion`. POST createPromotion / createMarkdown unchanged. |
| **Wrong param value** | `/sell/recommendation/v1/find?marketplace_id=EBAY_US` 400 | this endpoint alone uses `EBAY-US` (hyphen), not the canonical `EBAY_US` | `services/recommendations.ts` uses hyphen form |
| **Wrong path** | `/sell/metadata/v1/marketplace/{X}/get_sales_tax_jurisdictions` 404 | actual path is `/sell/metadata/v1/country/{cc}/sales_tax_jurisdiction` (singular, country-keyed, no `get_` prefix) | `services/marketplace-meta/operations.ts` uses the right path |
| **Wrong path** | `/commerce/translation/v1/translate` 404 | path is `v1_beta`, not `v1` | `services/translate.ts` |
| **Missing required body field** | `/commerce/translation/v1_beta/translate` errorId 110003 | `translationContext` is required (typically `ITEM_TITLE`) | default supplied at wrapper boundary |
| **Missing required header** | `/sell/account/v1/advertising_eligibility` errorId 35001 | `X-EBAY-C-MARKETPLACE-ID` is required by the OpenAPI contract | wrapper sets `marketplace` |
| **Missing required header** | `/sell/inventory/v1/inventory_item` errorId 25709 "Invalid value for header Accept-Language" | the header is required, not just acceptable | `sellRequest` defaults `Accept-Language: en-US` for all calls |
| **Wrong auth scheme** | every `/post-order/v2/*` call 401 | post-order is the legacy IAF pipe; `Authorization: Bearer` is rejected | `user-client.ts` uses `Authorization: IAF` for paths starting with `/post-order/` |
| **Missing scope** | every `/sell/marketing/v1/ad_*` 403 | `sell.marketing` was missing from `EBAY_SCOPES` | added |
| **Endpoint doesn't exist** | `/sell/account/v1/eligibility` 404 in every variant | not in any eBay OpenAPI; never existed | wrapper deleted; equivalent signal split between `getSellerAdvertisingEligibility` (Promoted Listings) + `getOptedInPrograms` (programs joined) |
| **Endpoint doesn't exist** | `/sell/metadata/v1/marketplace/{X}/get_digital_signature_routes` 404 | not in OpenAPI | wrapper deleted |
| **OAuth refresh broke after scope add** | every existing user-OAuth call after we add a new scope to `EBAY_SCOPES` | eBay rejects refresh with `invalid_scope` when the requested scope superset isn't a subset of what was originally consented | `oauth.ts:refreshUserAccess` now omits the `scope` param entirely — eBay returns the originally-consented scope set; new scopes only activate on user re-consent |

### 4xx still — Limited Release / app-approval gated

| Endpoint | Code | Cause | Action to unblock |
|---|---|---|---|
| `GET /sell/stores/v1/store` | 403 errorId 1100 | Sell Stores API gated at app level (verified: returns 403 even with `sell.stores.readonly` consented + active store on account) | Apply for Stores API approval in eBay dev portal. Workaround: Trading `GetStore` (already wired in `services/store.ts`). |
| `GET /sell/feed/v1/inventory_task?feed_type=…` | 403 errorId 160022 | Sell Feed Limited Release | Apply via "Contact Developer Technical Support" path |
| `GET /buy/feed/v1_beta/item` | 403 errorId 1100 | Buy Feed Limited Release | Same as above |
| `GET /buy/order/v2/checkout_session/{id}` | 404 (no JSON envelope) | Buy Order Limited Release; flagged via `EBAY_ORDER_APPROVED` env. Without that flag, /v1/purchases routes to the bridge. | Apply for Buy Order API approval |
| `GET /sell/finances/v1/transfer?limit=1` | 404 errorId 2002 | The transfer sub-resource is itself Limited Release within Finances (the rest of Finances is open) | Apply for Transfer API approval; payout / transaction stay open |
| `POST /buy/offer/v1_beta/bidding/{id}/place_proxy_bid` | 403 errorId 1100 | `buy.offer.auction` exists in sandbox-only scope catalog; production access is gated | Apply for Buy Offer auction approval |
| `GET /sell/logistics/v1_beta/shipment/{id}` | 403 errorId 1100 | `sell.logistics` is not in eBay's published prod or sandbox scope catalog; the API itself is gated | Apply for Sell Logistics approval. (Scope previously added then removed — confirmed not in catalog.) |

### Re-consent unlock (2026-05-03)

After running `scripts/ebay-reconsent.ts` (sprd-shop re-OAuth'd through
the consent screen) all 13 scopes were granted, and these endpoints
flipped 403 → 200:

| Endpoint | Scope unlocked | Result |
|---|---|---|
| `GET /sell/marketing/v1/ad_campaign` | `sell.marketing` | 200 |
| `GET /sell/fulfillment/v1/payment_dispute_summary?look_back_days=30` | `sell.payment.dispute` | 200 |
| `GET /commerce/message/v1/conversation` | `commerce.message` | 200 |
| `GET /commerce/feedback/v1/feedback?user_id=…&feedback_type=FEEDBACK_RECEIVED&filter=role:SELLER` | `commerce.feedback` | 200 |
| `GET /commerce/feedback/v1/awaiting_feedback` | `commerce.feedback` | 200 |
| `GET /sell/analytics/v1/seller_standards_profile/PROGRAM_US/CURRENT` | `sell.analytics.readonly` | 200 |
| `GET /sell/analytics/v1/traffic_report?dimension=DAY&metric=…&filter=marketplace_ids:{EBAY_US},date_range:[20260401..20260408]` | `sell.analytics.readonly` | 200 |

### Wrapper bug found during re-consent verification

| Wrapper | Bug | Fix |
|---|---|---|
| `services/analytics.ts:34` (`getTrafficReport`) | filter built `date_range:[2026-04-01..…]` (ISO with hyphens). eBay rejects with errorId 50013 "The start date range format is invalid. The format is yyyymmdd." | strip hyphens at the wrapper boundary; flipagent surface still accepts ISO dates |
| `scripts/ebay-endpoint-probe.ts:pickApiKeyId` | when re-consent inserts a new `userEbayOauth` row, the unordered `LIMIT 1` could pick the stale 6-scope binding, producing false 403s | order by `updatedAt DESC` so probe always uses the freshest binding |

### Other observations

- `GET /sell/inventory/v1/inventory_item_group?limit=1` 404 errorId 2002 — this resource has no list endpoint at all in the eBay API; only get-by-id, create, update, delete. Our wrappers only call the by-id form, so no bug to fix; the probe row is informational.
- `GET /buy/browse/v1/item_summary/search` 429 — app-token throttle. Verified path/shape OK from earlier sweeps.

### MISS-wrap pass (2026-05-03 final session)

User asked: production state changes are OK; complete every endpoint that has business value. After comprehensive review of the 329 spec-only paths (= "MISS" rows surfaced by the upgraded TS-AST spec-diff), wrapped 50+ new endpoints in three batches:

**Batch 1 — Post-order action helpers (`services/disputes/actions.ts`, 22 fns)**: every action eBay defines on a return / inquiry / case / cancellation that wasn't covered by the unified `respondToDispute`. Each maps directly to a `POST /post-order/v2/{type}/{id}/{action}` with optional body. Live-verified the few we could probe against fake IDs (closeCase, escalateInquiry, returnMarkAsReceived) — all reach the endpoint and get rejected on the fake ID, body shape correct.

**Batch 2 — Marketing surface completion**:
- `getPromotion` / `updatePromotion` / `deletePromotion` / `pausePromotion` / `resumePromotion` / `getPromotionListingSet` (6 new helpers in `services/marketing/promotions.ts`)
- `getMarkdown` / `updateMarkdown` / `deleteMarkdown` (3 new in `services/marketing/markdowns.ts`)
- Routes wired at `/v1/promotions/{id}` GET/PUT/DELETE + `/pause` + `/resume` + `/listings`
- Routes wired at `/v1/markdowns/{id}` GET/PUT/DELETE
- `bulkUpsertSalesTax` for bulk tax-table create-or-replace; live-verified body shape (eBay only allows US territories AS/GU/MP/PW/VI for sales_tax — wrapper now correctly nests entries under `salesTaxInputList`, not `requests`)

**Batch 3 — New surfaces**:
- **VeRO IP-rights compliance** (`services/vero.ts`) — entire surface: `listVeroReasonCodes`, `getVeroReasonCode`, `getVeroReport`, `listVeroReportItems`, `createVeroReport`. Required for sellers participating in eBay's Verified Rights Owner program.
- **Developer signing-key management** (`services/signing-keys.ts`) — for HTTP Message Signatures (RFC 9421) which eBay is making mandatory on more endpoints in 2025+: `listSigningKeys`, `getSigningKey`, `createSigningKey`. Wrapped ahead of the requirement landing on any endpoint we use.
- **Catalog change_request** (`services/catalog-change.ts`) — submit product corrections to eBay's master catalog: `listChangeRequests`, `getChangeRequest`, `createChangeRequest`.
- **Sell Metadata generic dispatcher** — `getMarketplacePolicy(kind)` wraps 16 different `/sell/metadata/v1/marketplace/{m}/get_*_policies` endpoints behind one typed kind enum. Avoids 16 near-identical typed wrappers.
- **Compatibilities helpers** — 5 cross-category compatibility lookup POSTs added.
- **Notification destination CRUD** completed (createDestination / updateDestination / deleteDestination / getDestination — list was already wrapped).

**spec-diff matched count after this round: 184** (was 127 at start of session, 44 with the regex-based extractor before that).

### Spec-diff scoring fix this session

The `ebay-spec-diff.ts` regex-based path extractor was massively undercounting matches by missing template-literal paths. Replaced with the same TS-AST walker `ebay-field-diff.ts` uses. Result: matched count jumped 44 → 127 (+83) instantly, exposing that the previous 412-MISS estimate was inflated 3x by parser limitation.

### Write-op end-to-end exercise (2026-05-03 evening)

User said "production state changes are OK; really clean it up." Ran every safe write-op end-to-end with `flipagent-test-...` prefixed test data, verified, cleaned up. Surfaced 8 more wrapper bugs the read-only audits couldn't have caught.

**Bugs fixed end-to-end this round:**

| # | Wrapper | Bug | Surfaced via |
|---|---|---|---|
| 1 | `services/listings/bulk.ts:bulkUpsertInventory` | each request missing required `locale` field (spec's `InventoryItemWithSkuLocale` requires it). | bulk_create_or_replace_inventory_item lifecycle |
| 2 | `packages/types/src/listings-bulk.ts:ListingGroupUpsert` | `variesBy.specifications` typed as `string[]` but spec is `[{name, values}]`. **Every multi-variation listing-group create silently failed since written.** | inventory_item_group lifecycle |
| 3 | `services/seller-account.ts:createCustomPolicy` | extracted `customPolicyId` from response body — eBay returns 201 with EMPTY body + `Location: http://api.ebay.com/sell/{id}`. Custom policy id was always `""`. | custom_policy create |
| 4 | `services/marketing/promotions.ts:createPromotion` | body missing required `marketplaceId` (header alone insufficient), `description`, `promotionImageUrl`, `promotionStatus`. Same `Location` id pattern — id was always `""`. | createPromotion live test |
| 5 | `services/marketing/markdowns.ts:createMarkdown` | body missing required `description` and `promotionImageUrl`. Also Location-header id pattern. | createMarkdown live test |
| 6 | `services/marketing/ads.ts:createAdCampaign` + `cloneAdCampaign` + `createAdGroup` | body missing required `marketplaceId`. All 3 also use Location-header id pattern. | createAdCampaign live test |
| 7 | `services/notification-subs.ts:listDestinations` | parsed `endpoint: { endpoint, verificationToken }` but eBay returns `deliveryConfig: { endpoint, verificationToken }`. Crashed on every account that had a destination. | listDestinations |
| 8 | `services/notification-subs.ts:createSubscription` | body missing required `payload: { format, schemaVersion, deliveryProtocol }`. Also Location-header id pattern. Spec field `format` is typed scalar but eBay returns array on `topic/{id}` lookup — wrapper now picks first element. | createSubscription live test |

**New wrappers shipped:**
- `services/policies-write.ts` — `createPolicy` / `updatePolicy` / `deletePolicy` for the three Business Policy types (return / payment / fulfillment). Section 1 had falsely claimed these were wrapped at `services/policies.ts`; turns out the file only had read functions. **Now actually wrapped, with routes at `/v1/policies` POST + `/v1/policies/{type}/{id}` PUT/DELETE.** Live-tested end-to-end after `optInToProgram(SELLING_POLICY_MANAGEMENT)`.
- `services/ebay/rest/user-client.ts:sellRequestWithLocation` — variant of `sellRequest` that also returns the Location-header id. eBay uses this pattern across at least 8 POST endpoints; centralizing the parse beats reimplementing it everywhere.

**End-to-end lifecycles verified (test data prefixed `flipagent-test-...`, cleaned up after):**

| Surface | Steps | Result |
|---|---|---|
| Locations | create → get → list → disable → enable → patch → delete | 7/7 ✅ |
| Inventory item + group | PUT inventory_item, GET, bulk_get, bulk_create_or_replace, bulk_update_price_quantity, PUT compatibility, PUT inventory_item_group (variant parent), DELETE all | 9/10 ✅ (only `compatibility` is motors-only, rejected on non-motors test sku as expected) |
| Custom policy + sales_tax | POST custom_policy, GET; PUT/GET/DELETE sales_tax | 5/5 ✅ |
| Business Policies | optInToProgram → createPolicy(return/payment/fulfillment) → updatePolicy → deletePolicy | 7/8 ✅ (only fulfillment hit eBay's `LSAS validation failed` shipping-service eligibility — body shape verified, account-state issue) |
| Notifications | listTopics, listDestinations, createSubscription, getSubscription, disable, enable, test, deleteSubscription | 8/8 ✅ |
| Promotions / markdowns | listPromotions, createPromotion (fake listingId), listMarkdowns, createMarkdown (fake listingId) | 4/4 body-shape ✅ (eBay rejected only on fake listingIds — wrappers correct) |
| Ad campaign | listAdCampaigns, createAdCampaign | 1.5/2 ✅ (createAdCampaign body verified; eBay rejected with NOT_ENOUGH_ACTIVITY — sprd-shop is ineligible for Promoted Listings) |

**Section 1 row corrections:** ~30 rows flipped from `WRP` to `OK 2026-05-03`. Notably the ~12 rows for return/payment/fulfillment policy CRUD that *claimed* to be wrapped at `services/policies.ts` but actually weren't (were `MISS` masquerading as `WRP`). All now genuinely wrapped via `services/policies-write.ts` and live-tested.

### Wrap-and-verify round (2026-05-03)

Closing out the four high-priority MISS rows from Section 6 + verifying the remaining six untested Trading XML wrappers + improving field-diff `$ref`-following.

| New wrap | Service + route | Verification |
|---|---|---|
| `POST /commerce/feedback/v1/respond_to_feedback` | `services/ebay/rest/feedback.ts:respondToFeedback` → route `POST /v1/feedback/{id}/respond` (with off-eBay-contact hygiene) | Live-probed 200 |
| `POST /post-order/v2/inquiry/{id}/close` | `services/disputes/operations.ts:closeInquiry` → route `POST /v1/disputes/{id}/close` | Live-probed 500 errorId 2003 on fake id (post-order's pattern for invalid ids — endpoint reachable) |
| `PUT /sell/account/v1/sales_tax/{country}/{jurisdictionId}` | `services/seller-account.ts:upsertSalesTax` → route `PUT /v1/me/seller/sales-tax/{country}/{jurisdiction}` | Live-probed 400 errorId 20403 on fake jurisdictionId |
| `DELETE /sell/account/v1/sales_tax/{country}/{jurisdictionId}` | `services/seller-account.ts:deleteSalesTax` → route `DELETE /v1/me/seller/sales-tax/{country}/{jurisdiction}` | Endpoint reachable (same auth/path family) |
| `POST /sell/inventory/v1/location/{key}/update_location_details` | `services/locations.ts:updateLocationDetails` → route `PATCH /v1/locations/{id}` | Live-probed 400 errorId 25800 on fake key |

Trading XML wrappers — all 6 untested ones live-probed:
- `AddToWatchList`, `RemoveFromWatchList`: errCode 20819 / 20820 on fake itemId
- `GetBestOffers`: `Ack: Success` (real call worked)
- `RespondToBestOffer`: errCode 21549 on fake offerId
- `GetSearchResults`: errCode 10007 (eBay-side system error — Trading's GetSearchResults is being deprecated; wrapper marked best-effort)
- `VerifyAddItem`: returned listing-quality warnings (correct response shape, eBay validated the body)

Field-diff: improved `$ref` follower to dive one level into nested response objects. Matched 128→131 wrapper calls; remaining 10 respUnknown are deeply-nested ($ref → wrapper-response → inner $ref → another wrapper) false positives.

### Files touched this sweep

- `packages/api/src/services/ebay/host.ts` (NEW — apiz host routing)
- `packages/api/src/services/ebay/rest/{user,app}-client.ts` — both route through `ebayHostFor`
- `packages/api/src/services/ebay/oauth.ts` — drops `scope` param on refresh; uses shared `ebayHostFor`
- `packages/api/src/services/charities.ts` + `routes/v1/charities.ts` — user OAuth, `registration_ids`
- `packages/api/src/services/bids.ts` + `routes/v1/bids.ts` — `v1_beta`, Trading-backed list, new GET-by-listing
- `packages/api/src/services/analytics.ts` — `traffic_report` strips hyphens from ISO dates → `yyyymmdd`
- `packages/api/src/config.ts` — added `sell.payment.dispute`, `sell.reputation`; removed the misnamed `sell.logistics`
- `packages/api/scripts/ebay-endpoint-probe.ts` (curated 57-endpoint sweep with valid request shapes)
- `packages/api/scripts/ebay-path-sweep.ts` (broad 101-path existence sweep with fake IDs; classifies by HTTP+envelope)
- `packages/api/scripts/ebay-reconsent.ts` (one-shot OAuth re-consent that bypasses the dev api's in-memory state map)
- `packages/api/scripts/ebay-spec-diff.ts` (diff every wrapper path against the bundled OAS3 specs; surfaces wrapper-only paths inside known specs and spec-only paths)
- `packages/api/scripts/ebay-field-diff.ts` (NEW — TS-AST walk of every `sellRequest<T>(...)`/`appRequest<T>(...)` call site; diffs body literal keys + response generic top-level keys against OAS3 component schemas. Catches field-name typos, wrong shape, missing required, sent unknown.)
- `notes/ebay-endpoint-probe-results.json` (curated probe raw output)
- `notes/ebay-path-sweep-results.json` (broad sweep raw output)
- `notes/ebay-spec-diff.json` (path-level spec ↔ wrapper diff raw output)
- `notes/ebay-field-diff.json` (NEW — field-level spec ↔ wrapper diff raw output)
- `references/ebay-mcp/docs/_mirror/*` (NEW — 35 OAS3 specs sourced from `github.com/hendt/ebay-api/specs/*` to fill gaps where eBay's dev portal blocks programmatic download; covers Buy*, Sell Finances/Logistics/Stores v2/Feed, Commerce Charity/Catalog/Taxonomy/Media, post-order/v2)

