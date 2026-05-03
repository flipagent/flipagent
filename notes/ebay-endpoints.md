# eBay endpoint maintenance table

_Source of truth for every eBay endpoint, our coverage, and live status._
_Last updated: 2026-05-02. Update by hand as you verify/fix rows._

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
| GET | `/item/{item_id}/check_compatibility` | `buy.browse` (app) | `services/compatibility.ts:31` | `/v1/items/{id}/compatibility` | WRP | |
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

### Buy / Order (`/buy/order/v1`) — LR

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| POST | `/checkout_session/initiate` | `buy.order` (user) | `services/purchases/orchestrate.ts` (called via orchestrator) | `/v1/purchases` POST | OK (REST + bridge) | Gated by `EBAY_ORDER_API_APPROVED`. |
| GET | `/checkout_session/{id}` | `buy.order` (user) | `services/purchases/orchestrate.ts` | `/v1/purchases/{id}` | OK | |
| POST | `/checkout_session/{id}/place_order` | `buy.order` (user) | `services/purchases/orchestrate.ts` | `/v1/purchases/{id}` POST `place_order` | OK | |
| POST | `/checkout_session/{id}/shipping_address` | `buy.order` (user) | `services/purchases/orchestrate.ts:171` | `/v1/purchases/{id}/shipping_address` | OK | REST-only (bridge returns 412). |
| POST | `/checkout_session/{id}/payment_instrument` | `buy.order` (user) | `services/purchases/orchestrate.ts:186` | `/v1/purchases/{id}/payment_instrument` | OK | REST-only. |
| POST | `/checkout_session/{id}/coupon` | `buy.order` (user) | `services/purchases/orchestrate.ts:208` | `/v1/purchases/{id}/coupon` | OK | REST-only. |
| DELETE | `/checkout_session/{id}/coupon` | `buy.order` (user) | `services/purchases/orchestrate.ts:215` | `/v1/purchases/{id}/coupon` DELETE | OK | REST-only. |
| GET | `/guest_checkout_session/...` | `buy.guest.order` (app) | MISS | — | MISS | Guest variant — same shape, different scope. |

### Buy / Offer (proxy bidding) (`/buy/offer/v1_beta`) — LR

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/bidding/{listing_id}` | `buy.offer.auction` (user) | `services/bids.ts:56` | `/v1/bids/{id}` | WRP — open follow-up: 404 on probe (Section 6) | |
| POST | `/bidding/{listing_id}/place_proxy_bid` | `buy.offer.auction` (user) | `services/bids.ts:65` | `/v1/bids/{id}/place` | WRP | |
| GET | `/find_eligible_items` | `buy.offer.auction` (user) | `services/compatibility.ts:59` | `/v1/bids/eligible` | WRP | Same path used by both bids + compat — confusing co-location. |

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
| GET | `/deal_item` | `buy.deal` (app) | `services/featured.ts:39` | `/v1/featured?kind=daily_deal` | WRP | |
| GET | `/event_item` | `buy.deal` (app) | `services/featured.ts:39` | `/v1/featured?kind=event` | WRP | |
| GET | `/deal/{deal_id}` | `buy.deal` (app) | MISS | — | MISS | |
| GET | `/event/{event_id}` | `buy.deal` (app) | MISS | — | MISS | |

---

### Sell / Account v1 (`/sell/account/v1`)

OpenAPI: `sell-apps/account-management/sell_account_v1_oas3.json`. All scope `sell.account` unless noted.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/custom_policy/` | `services/seller-account.ts:174` | `/v1/policies/custom` | WRP | |
| POST | `/custom_policy/` | `services/seller-account.ts:192` | `/v1/policies/custom` POST | WRP | |
| GET | `/custom_policy/{custom_policy_id}` | MISS | — | MISS | |
| PUT | `/custom_policy/{custom_policy_id}` | MISS | — | MISS | |
| POST | `/fulfillment_policy/` | `services/policies.ts` (via shared helper) | `/v1/policies` POST | WRP | |
| GET | `/fulfillment_policy/{fulfillmentPolicyId}` | `services/policies.ts` | `/v1/policies/{id}` | WRP | |
| PUT | `/fulfillment_policy/{fulfillmentPolicyId}` | `services/policies.ts` | `/v1/policies/{id}` PUT | WRP | |
| DELETE | `/fulfillment_policy/{fulfillmentPolicyId}` | `services/policies.ts` | `/v1/policies/{id}` DELETE | WRP | |
| GET | `/fulfillment_policy?marketplace_id=...` | `services/listings/defaults.ts:64` + `services/policies.ts` | `/v1/policies` | WRP | |
| GET | `/fulfillment_policy/get_by_policy_name` | `services/policies.ts` | `/v1/policies?name=` | WRP | |
| POST | `/fulfillment_policy/{id}/transfer` | `services/seller-account.ts:229` | `/v1/policies/{id}/transfer` | WRP | |
| GET | `/payment_policy?marketplace_id=...` | `services/listings/defaults.ts:59` + `services/policies.ts` | `/v1/policies` | WRP | |
| POST | `/payment_policy` | `services/policies.ts` | `/v1/policies` POST | WRP | |
| GET | `/payment_policy/{payment_policy_id}` | `services/policies.ts` | `/v1/policies/{id}` | WRP | |
| PUT | `/payment_policy/{payment_policy_id}` | `services/policies.ts` | `/v1/policies/{id}` PUT | WRP | |
| DELETE | `/payment_policy/{payment_policy_id}` | `services/policies.ts` | `/v1/policies/{id}` DELETE | WRP | |
| GET | `/payment_policy/get_by_policy_name` | `services/policies.ts` | `/v1/policies?name=` | WRP | |
| GET | `/payments_program/{marketplace_id}/{payments_program_type}` | `services/seller-account.ts:78` | `/v1/me/seller` | WRP | |
| GET | `/payments_program/{marketplace_id}/{payments_program_type}/onboarding` | MISS | — | MISS | |
| GET | `/privilege` | `services/seller-account.ts:39` | `/v1/me/seller` | WRP | |
| GET | `/program/get_opted_in_programs` | `services/me-account.ts:71` | `/v1/me/programs` | WRP | |
| POST | `/program/opt_in` | `services/me-account.ts:86` | `/v1/me/programs/opt-in` | WRP | |
| POST | `/program/opt_out` | `services/me-account.ts:99` | `/v1/me/programs/opt-out` | WRP | |
| GET | `/rate_table` | `services/seller-account.ts:145` | `/v1/me/seller` | WRP | |
| GET | `/return_policy?marketplace_id=...` | `services/listings/defaults.ts:54` + `services/policies.ts` | `/v1/policies` | WRP | |
| POST | `/return_policy` | `services/policies.ts` | `/v1/policies` POST | WRP | |
| GET | `/return_policy/{return_policy_id}` | `services/policies.ts` | `/v1/policies/{id}` | WRP | |
| PUT | `/return_policy/{return_policy_id}` | `services/policies.ts` | `/v1/policies/{id}` PUT | WRP | |
| DELETE | `/return_policy/{return_policy_id}` | `services/policies.ts` | `/v1/policies/{id}` DELETE | WRP | |
| GET | `/return_policy/get_by_policy_name` | `services/policies.ts` | `/v1/policies?name=` | WRP | |
| POST | `/bulk_create_or_replace_sales_tax` | MISS | — | MISS | |
| GET | `/sales_tax/{countryCode}/{jurisdictionId}` | MISS | — | MISS | |
| PUT | `/sales_tax/{countryCode}/{jurisdictionId}` | MISS | — | MISS | |
| DELETE | `/sales_tax/{countryCode}/{jurisdictionId}` | MISS | — | MISS | |
| GET | `/sales_tax?country_code=` | `services/seller-account.ts:122` | `/v1/me/seller/sales-tax` | WRP | |
| GET | `/subscription` | `services/seller-account.ts:68` | `/v1/me/seller` | WRP | |
| GET | `/kyc` | `services/seller-account.ts:59` | `/v1/me/seller` | WRP | |
| GET | `/advertising_eligibility` | `services/seller-account.ts:100` | `/v1/me/seller` | WRP | |

### Sell / Account v2 (Stores) (`/sell/stores/v2`)

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/store-categories` | `services/store.ts:35` | `/v1/store/categories` | WRP | |
| POST | `/store-categories` | `services/store.ts:50` | `/v1/store/categories` POST | WRP | |
| DELETE | `/store-categories` | MISS | — | MISS | |

`/sell/stores/v1/*` (the older Stores API for store metadata) — see Section 5: gated behind app approval we don't have. Uses Trading `GetStore` instead.

### Sell / Inventory (`/sell/inventory/v1`)

OpenAPI: `sell-apps/listing-management/sell_inventory_v1_oas3.json`. Scopes `sell.inventory` (write) / `sell.inventory.readonly` (read).

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/bulk_create_or_replace_inventory_item` | `services/listings/bulk.ts:78` | `/v1/listings/bulk` | WRP | |
| POST | `/bulk_get_inventory_item` | `services/listings/bulk.ts:222` | `/v1/listings/bulk` GET | WRP | |
| POST | `/bulk_update_price_quantity` | `services/listings/bulk.ts:53` | `/v1/listings/bulk/price-quantity` | WRP | |
| GET | `/inventory_item/{sku}` | `services/listings/get.ts:42`, `services/listings/lifecycle.ts:41` | `/v1/listings/{sku}` | OK | |
| PUT | `/inventory_item/{sku}` | `services/listings/create.ts:86`, `services/listings/lifecycle.ts:74` | `/v1/listings` POST + `/v1/listings/{sku}` PUT | OK | |
| DELETE | `/inventory_item/{sku}` | `services/listings/lifecycle.ts:41` (chained) | `/v1/listings/{sku}` DELETE | WRP | |
| GET | `/inventory_item` | `services/listings/get.ts:83` | `/v1/listings` | WRP | |
| GET | `/inventory_item/{sku}/product_compatibility` | `services/listings/compatibility.ts:74` | `/v1/listings/{sku}/compatibility` | WRP | |
| PUT | `/inventory_item/{sku}/product_compatibility` | `services/listings/compatibility.ts:59` | `/v1/listings/{sku}/compatibility` PUT | WRP | |
| DELETE | `/inventory_item/{sku}/product_compatibility` | `services/listings/compatibility.ts:91` | `/v1/listings/{sku}/compatibility` DELETE | WRP | |
| GET | `/inventory_item_group/{key}` | `services/listings/bulk.ts:133` | `/v1/listing-groups/{id}` | WRP | |
| PUT | `/inventory_item_group/{key}` | `services/listings/bulk.ts:159` | `/v1/listing-groups/{id}` PUT | WRP | |
| DELETE | `/inventory_item_group/{key}` | `services/listings/bulk.ts:181` | `/v1/listing-groups/{id}` DELETE | WRP | |
| POST | `/bulk_migrate_listing` | `services/listings/bulk.ts:200` | `/v1/listings/bulk/migrate` | WRP | |
| GET | `/listing/{listingId}/sku/{sku}/locations` | `services/listings/sku-locations.ts:33` | `/v1/listings/{id}/sku/{sku}/locations` | WRP | |
| PUT | `/listing/{listingId}/sku/{sku}/locations` | `services/listings/sku-locations.ts:49` | PUT | WRP | |
| DELETE | `/listing/{listingId}/sku/{sku}/locations` | `services/listings/sku-locations.ts:60` | DELETE | WRP | |
| POST | `/bulk_create_offer` | MISS | — | MISS | |
| POST | `/bulk_publish_offer` | `services/listings/bulk.ts:103` | `/v1/listings/bulk/publish` | WRP | |
| GET | `/offer?sku=` | `services/listings/get.ts:53,97` | `/v1/listings/{sku}` | OK | |
| POST | `/offer` | `services/listings/create.ts:96` | `/v1/listings` POST | OK | |
| GET | `/offer/{offerId}` | (read via `?sku=`) | — | WRP | |
| PUT | `/offer/{offerId}` | `services/listings/lifecycle.ts:84` | `/v1/listings/{sku}` PUT | OK | |
| DELETE | `/offer/{offerId}` | `services/listings/lifecycle.ts:84` (chained) | DELETE | WRP | |
| POST | `/offer/get_listing_fees` | `services/listings/preview-fees.ts:70` | `/v1/listings/preview-fees` | OK 2026-05-02 | Returns insertion-time fees only — see Section 5 caveat about FVF. |
| POST | `/offer/{offerId}/publish` | `services/listings/lifecycle.ts:104`, `services/listings/create.ts:113` | `/v1/listings/{sku}/publish` | OK | |
| POST | `/offer/publish_by_inventory_item_group` | `services/listings/groups.ts:30` | `/v1/listing-groups/{id}/publish` | WRP | |
| POST | `/offer/{offerId}/withdraw` | `services/listings/lifecycle.ts:28` | `/v1/listings/{sku}/withdraw` | WRP | |
| POST | `/offer/withdraw_by_inventory_item_group` | `services/listings/groups.ts:51` | `/v1/listing-groups/{id}/withdraw` | WRP | |
| GET | `/location/{merchantLocationKey}` | `services/locations.ts:69` | `/v1/locations/{id}` | WRP | |
| POST | `/location/{merchantLocationKey}` | `services/locations.ts:82` | `/v1/locations` POST | WRP | |
| DELETE | `/location/{merchantLocationKey}` | `services/locations.ts:109` | `/v1/locations/{id}` DELETE | WRP | |
| POST | `/location/{merchantLocationKey}/disable` | `services/locations.ts:118` (action) | `/v1/locations/{id}/disable` | WRP | |
| POST | `/location/{merchantLocationKey}/enable` | `services/locations.ts:118` (action) | `/v1/locations/{id}/enable` | WRP | |
| GET | `/location` | `services/locations.ts:60`, `services/listings/defaults.ts:69` | `/v1/locations` | WRP | |
| POST | `/location/{merchantLocationKey}/update_location_details` | MISS | — | MISS | |
| POST | `/bulk_get_offer` | `services/listings/bulk.ts:236` | `/v1/listings/bulk` GET | WRP | |

### Sell / Fulfillment (`/sell/fulfillment/v1`)

OpenAPI: `sell-apps/order-management/sell_fulfillment_v1_oas3.json`. Mixed scopes (`sell.fulfillment`, `sell.finances`, `sell.payment.dispute`).

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/order/{orderId}` | `sell.fulfillment` | `services/sales/operations.ts:42` | `/v1/sales/{id}` | OK | |
| GET | `/order` | `sell.fulfillment` | `services/sales/operations.ts:31` | `/v1/sales` | OK | |
| POST | `/order/{order_id}/issue_refund` | `sell.finances` | `services/sales/operations.ts:86` | `/v1/sales/{id}/refund` | WRP | |
| GET | `/order/{orderId}/shipping_fulfillment` | `sell.fulfillment` | `services/sales/operations.ts:59` | `/v1/sales/{id}/fulfillments` | WRP | |
| POST | `/order/{orderId}/shipping_fulfillment` | `sell.fulfillment` | `services/sales/operations.ts:59` | `/v1/sales/{id}/ship` | OK | |
| GET | `/order/{orderId}/shipping_fulfillment/{fulfillmentId}` | `sell.fulfillment` | MISS | — | MISS | |
| GET | `/payment_dispute/{id}` | `sell.payment.dispute` | `services/disputes/operations.ts:88` | `/v1/disputes/{id}` | OK | |
| GET | `/payment_dispute/{id}/fetch_evidence_content` | `sell.payment.dispute` | `services/disputes/evidence.ts:137` | `/v1/disputes/{id}/evidence/{evidenceId}/file/{fileId}` | WRP | |
| GET | `/payment_dispute/{id}/activity` | `sell.payment.dispute` | `services/disputes/operations.ts:194` | `/v1/disputes/{id}/activity` | OK 2026-05-02 | |
| GET | `/payment_dispute_summary` (via `/payment_dispute/search`) | `sell.payment.dispute` | `services/disputes/operations.ts:56` (uses `/payment_dispute/search`) | `/v1/disputes` | OK | |
| POST | `/payment_dispute/{id}/contest` | `sell.payment.dispute` | `services/disputes/operations.ts:141` | `/v1/disputes/{id}/respond` | OK 2026-05-02 | |
| POST | `/payment_dispute/{id}/accept` | `sell.payment.dispute` | `services/disputes/operations.ts:141` | `/v1/disputes/{id}/respond` (action=accept) | OK | |
| POST | `/payment_dispute/{id}/upload_evidence_file` | `sell.payment.dispute` | `services/disputes/evidence.ts` | `/v1/disputes/{id}/evidence/upload` | WRP | Multipart binary upload. |
| POST | `/payment_dispute/{id}/add_evidence` | `sell.payment.dispute` | `services/disputes/evidence.ts:95` | `/v1/disputes/{id}/evidence` POST | WRP | |
| POST | `/payment_dispute/{id}/update_evidence` | `sell.payment.dispute` | `services/disputes/evidence.ts:113` | `/v1/disputes/{id}/evidence` PUT | WRP | |

### Sell / Finances (`/sell/finances/v1`)

OpenAPI not bundled. Endpoints inferred from our wrappers + eBay docs. Scope `sell.finances`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/payout` | `services/money/operations.ts:53` | `/v1/payouts` | OK | |
| GET | `/payout/{id}` | MISS | — | MISS | |
| GET | `/payout_summary` | `services/money/operations.ts:74` | `/v1/payouts/summary` | WRP | |
| GET | `/transaction` | `services/money/operations.ts:101` | `/v1/transactions` | OK | |
| GET | `/transaction_summary` | MISS | — | MISS | |
| GET | `/transfer` | `services/money/operations.ts:122` | `/v1/transfers` | WRP | |
| GET | `/transfer/{id}` | MISS | — | MISS | |
| POST | `/seller_funds_summary` | MISS | — | MISS | |

### Sell / Marketing (`/sell/marketing/v1`)

OpenAPI: `sell-apps/markeitng-and-promotions/sell_marketing_v1_oas3.json` (typo'd dirname `markeitng`). Scopes `sell.marketing` / `sell.marketing.readonly`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/ad_campaign/{cid}/bulk_create_ads_by_inventory_reference` | `services/marketing/ads.ts:350` | `/v1/ads/bulk-by-ref` | WRP | |
| POST | `/ad_campaign/{cid}/bulk_create_ads_by_listing_id` | `services/marketing/ads.ts:223` | `/v1/ads/bulk-by-listing` | WRP | |
| POST | `/ad_campaign/{cid}/bulk_delete_ads_by_inventory_reference` | `services/marketing/ads.ts:384` | `/v1/ads/bulk-delete-by-ref` | WRP | |
| POST | `/ad_campaign/{cid}/bulk_delete_ads_by_listing_id` | `services/marketing/ads.ts:286` | `/v1/ads/bulk-delete-by-listing` | WRP | |
| POST | `/ad_campaign/{cid}/bulk_update_ads_bid_by_inventory_reference` | `services/marketing/ads.ts:369` | `/v1/ads/bulk-bid-by-ref` | WRP | |
| POST | `/ad_campaign/{cid}/bulk_update_ads_bid_by_listing_id` | `services/marketing/ads.ts:260` | `/v1/ads/bulk-bid-by-listing` | WRP | |
| POST | `/ad_campaign/{cid}/bulk_update_ads_status` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/bulk_update_ads_status_by_listing_id` | `services/marketing/ads.ts:404` | `/v1/ads/bulk-status` | WRP | |
| GET | `/ad_campaign/{cid}/ad` | `services/marketing/ads.ts:99` | `/v1/ads` | WRP | |
| POST | `/ad_campaign/{cid}/ad` | `services/marketing/ads.ts:99` | `/v1/ads` POST | WRP | |
| POST | `/ad_campaign/{cid}/create_ads_by_inventory_reference` | MISS | — | MISS | |
| GET | `/ad_campaign/{cid}/ad/{ad_id}` | MISS | — | MISS | |
| DELETE | `/ad_campaign/{cid}/ad/{ad_id}` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/delete_ads_by_inventory_reference` | MISS | — | MISS | (single, non-bulk) |
| GET | `/ad_campaign/{cid}/get_ads_by_inventory_reference` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/ad/{ad_id}/update_bid` | `services/marketing/ads.ts:194` | `/v1/ads/{id}/bid` | WRP | |
| GET | `/ad_campaign/{cid}/ad_group` | `services/marketing/ads.ts:133`,`421` | `/v1/ads/{cid}/groups` | WRP | |
| POST | `/ad_campaign/{cid}/ad_group` | `services/marketing/ads.ts:421` | `/v1/ads/{cid}/groups` POST | WRP | |
| GET | `/ad_campaign/{cid}/ad_group/{gid}` | MISS | — | MISS | |
| PUT | `/ad_campaign/{cid}/ad_group/{gid}` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/ad_group/{gid}/suggest_bids` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/ad_group/{gid}/suggest_keywords` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/clone` | `services/marketing/ads.ts:175` | `/v1/ads/{cid}/clone` | WRP | |
| GET | `/ad_campaign` | `services/marketing/ads.ts:52` | `/v1/ads` | WRP | (now works after `sell.marketing` scope fix; see notes/ebay-coverage.md G.6) |
| POST | `/ad_campaign` | `services/marketing/ads.ts:76` | `/v1/ads/campaigns` POST | WRP | |
| GET | `/ad_campaign/{cid}` | MISS (via list filter) | — | MISS | |
| DELETE | `/ad_campaign/{cid}` | MISS | — | MISS | |
| POST | `/ad_campaign/{cid}/end` | `services/marketing/ads.ts:157` (action) | `/v1/ads/{cid}/end` | WRP | |
| GET | `/ad_campaign/find_campaign_by_ad_reference` | MISS | — | MISS | |
| GET | `/ad_campaign/get_campaign_by_name` | `services/marketing/ads.ts:146` | `/v1/ads?name=` | WRP | |
| POST | `/ad_campaign/{cid}/launch` | `services/marketing/ads.ts:157` | `/v1/ads/{cid}/launch` | WRP | |
| POST | `/ad_campaign/{cid}/pause` | `services/marketing/ads.ts:157` | `/v1/ads/{cid}/pause` | WRP | |
| POST | `/ad_campaign/{cid}/resume` | `services/marketing/ads.ts:157` | `/v1/ads/{cid}/resume` | WRP | |
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
| GET | `/ad_report/{report_id}` | `services/marketing/reports.ts:124` (raw URL) | `/v1/ads/reports/{id}/download` | WRP | |
| GET | `/ad_report_metadata` | `services/marketing/reports.ts:143` | `/v1/ads/reports/metadata` | WRP | |
| GET | `/ad_report_metadata/{report_type}` | MISS | — | MISS | |
| GET | `/ad_report_task` | `services/marketing/reports.ts:62` (kind=ad) | `/v1/ads/reports` | WRP | |
| POST | `/ad_report_task` | `services/marketing/reports.ts:86` (kind=ad) | `/v1/ads/reports` POST | WRP | |
| GET | `/ad_report_task/{report_task_id}` | `services/marketing/reports.ts:76` | `/v1/ads/reports/{id}` | WRP | |
| DELETE | `/ad_report_task/{report_task_id}` | MISS | — | MISS | |
| POST | `/item_price_markdown` | `services/marketing/markdowns.ts:53` | `/v1/markdowns` POST | WRP — open follow-up: 400 invalid_request on probe (Section 6) | |
| GET | `/item_price_markdown/{pid}` | `services/marketing/markdowns.ts:43` | `/v1/markdowns` | WRP — open follow-up: 400 (Section 6) | |
| PUT | `/item_price_markdown/{pid}` | MISS | — | MISS | |
| DELETE | `/item_price_markdown/{pid}` | MISS | — | MISS | |
| POST | `/item_promotion` | `services/marketing/promotions.ts:143` | `/v1/promotions` POST | WRP — open follow-up: 400 (Section 6) | |
| GET | `/item_promotion/{pid}` | `services/marketing/promotions.ts:96` | `/v1/promotions/{id}` | WRP | |
| PUT | `/item_promotion/{pid}` | MISS | — | MISS | |
| DELETE | `/item_promotion/{pid}` | MISS | — | MISS | |
| GET | `/promotion/{pid}/get_listing_set` | MISS | — | MISS | |
| GET | `/promotion` | `services/marketing/promotions.ts:96` | `/v1/promotions` | WRP — open follow-up: 400 (Section 6) | |
| POST | `/promotion/{pid}/pause` | MISS | — | MISS | |
| POST | `/promotion/{pid}/resume` | MISS | — | MISS | |
| GET | `/promotion_report` | MISS | — | MISS | |
| GET | `/promotion_summary_report` | `services/marketing/reports.ts:62` (kind=promotion_summary) | `/v1/promotions/reports` | WRP | |
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
| GET | `/customer_service_metric/{type}/{eval}` | `services/analytics.ts:102` (path constant only — no caller) | — | WRP — wiring abandoned | |
| GET | `/seller_standards_profile` | MISS | — | MISS | |
| GET | `/seller_standards_profile/{program}/{cycle}` | `services/analytics.ts:75` | `/v1/analytics/standards` | WRP | |
| GET | `/traffic_report` | `services/analytics.ts:45` | `/v1/analytics/traffic` | WRP | |

### Sell / Compliance (`/sell/compliance/v1`)

OpenAPI: `sell-apps/other-apis/sell_compliance_v1_oas3.json`. Scope `sell.inventory`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/listing_violation_summary` | `services/violations.ts:88` | `/v1/violations/summary` | WRP | |
| GET | `/listing_violation` | `services/violations.ts:71` | `/v1/violations` | WRP | |
| POST | `/suppress_violation` | MISS | — | MISS | (per ebay docs, not in OpenAPI) |

### Sell / Recommendation (`/sell/recommendation/v1`)

OpenAPI: `sell-apps/markeitng-and-promotions/sell_recommendation_v1_oas3.json`. Scope `sell.inventory`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/find` | `services/recommendations.ts:36` | `/v1/recommendations` | WRP | |

### Sell / Logistics (`/sell/logistics/v1_beta`)

OpenAPI not bundled. Endpoints from our wrappers + docs. Scope `sell.logistics`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| POST | `/shipping_quote` | `services/labels.ts:35` | `/v1/ship/quote` | WRP | |
| POST | `/shipment` | `services/labels.ts:61` | `/v1/ship` | WRP | |
| GET | `/shipment/{id}` | MISS | — | MISS | |
| POST | `/shipment/{id}/cancel` | `services/labels.ts:86` | `/v1/ship/{id}/cancel` | WRP | |
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
| GET | `/marketplace/{m}/get_return_policies` | `services/marketplace-meta/operations.ts:52` | `/v1/marketplaces/{id}` | WRP | |
| GET | `/marketplace/{m}/get_shipping_policies` | MISS | — | MISS | |
| GET | `/marketplace/{m}/get_site_visibility_policies` | MISS | — | MISS | |
| POST | `/compatibilities/get_compatibilities_by_specification` | MISS | — | MISS | |
| POST | `/compatibilities/get_compatibility_property_names` | MISS | — | MISS | |
| POST | `/compatibilities/get_compatibility_property_values` | MISS | — | MISS | |
| POST | `/compatibilities/get_multi_compatibility_property_values` | MISS | — | MISS | |
| POST | `/compatibilities/get_product_compatibilities` | MISS | — | MISS | |
| GET | `/country/{cc}/sales_tax_jurisdiction` | `services/marketplace-meta/operations.ts:57` | `/v1/marketplaces/{id}` (sales-tax block) | WRP | |
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
| GET | `/product/{epid}` | `commerce.catalog.readonly` (app) | `services/products.ts:94` (REST) + `services/ebay/scrape/catalog.ts:123` (scrape) | `/v1/products/{epid}` | LR + scrape primary | Gated by `EBAY_CATALOG_APPROVED`. |
| GET | `/product_summary/search` | `commerce.catalog.readonly` (app) | `services/products.ts:165` + `services/ebay/scrape/catalog.ts:222` | `/v1/products` | LR + scrape primary | |
| GET | `/product/{epid}/get_aspects_for_product` | `commerce.catalog.readonly` (app) | MISS | — | MISS | |

### Commerce / Charity (`/commerce/charity/v1`)

OpenAPI not bundled. Service stub.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/charity_org/search` | `services/charities.ts:50` | `/v1/charities` | WRP — wiring incomplete | |
| GET | `/charity_org/{idOrEin}` | `services/charities.ts:62` | `/v1/charities/{id}` | WRP — wiring incomplete | |

### Commerce / Identity (`/commerce/identity/v1`)

OpenAPI: `sell-apps/other-apis/commerce_identity_v1_oas3.json`. Scope `commerce.identity.readonly`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/user/` | MISS (sanity-checked OK in coverage doc G.1, but no caller wired) | — | MISS | Cap matrix `identity.user` claims rest:user but no service file. |

### Commerce / Media (`/commerce/media/v1_beta`)

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| POST/GET | `/image` | `commerce.media` (user) | `services/media.ts:25` | `/v1/media` | WRP | |
| POST/GET | `/video` | `commerce.media` (user) | `services/media.ts:25` | `/v1/media` | WRP | |
| GET | `/{type}/{id}` | `commerce.media` (user) | `services/media.ts:44` | `/v1/media/{id}` | WRP | |
| POST | `/upload_from_url` (batch) | `commerce.media` (user) | MISS | — | MISS | |
| GET | `/video` (list) | `commerce.media` (user) | MISS | — | MISS | |

### Commerce / Notification (`/commerce/notification/v1`)

OpenAPI: `sell-apps/communication/commerce_notification_v1_oas3.json`. Default scope `api_scope`.

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/config` | `services/notification-subs.ts:225` | `/v1/notifications/config` | WRP | |
| PUT | `/config` | `services/notification-subs.ts:235` | `/v1/notifications/config` PUT | WRP | |
| GET | `/destination` | MISS (we POST only) | — | MISS | |
| POST | `/destination` | `services/notification-subs.ts:90` | `/v1/notifications/destinations` | WRP | |
| GET | `/destination/{did}` | MISS | — | MISS | |
| PUT | `/destination/{did}` | MISS | — | MISS | |
| DELETE | `/destination/{did}` | MISS | — | MISS | |
| GET | `/public_key/{kid}` | `services/notification-subs.ts:252` | `/v1/notifications/public-key/{id}` | WRP | |
| GET | `/subscription` | `services/notification-subs.ts:60` (read in same file) | `/v1/notifications/subscriptions` | WRP | |
| POST | `/subscription` | `services/notification-subs.ts:39` | POST | WRP | |
| POST | `/subscription/{sid}/filter` | `services/notification-subs.ts:194` | `/v1/notifications/subscriptions/{id}/filter` | WRP | |
| GET | `/subscription/{sid}` | `services/notification-subs.ts:48` | `/v1/notifications/subscriptions/{id}` | WRP | |
| PUT | `/subscription/{sid}` | `services/notification-subs.ts:76` | PUT | WRP | |
| DELETE | `/subscription/{sid}` | `services/notification-subs.ts:48` (DELETE branch) | DELETE | WRP | |
| GET | `/subscription/{sid}/filter/{fid}` | `services/notification-subs.ts:208` | GET | WRP | |
| DELETE | `/subscription/{sid}/filter/{fid}` | `services/notification-subs.ts:173` | DELETE | WRP | |
| POST | `/subscription/{sid}/disable` | `services/notification-subs.ts:133` | POST | WRP | |
| POST | `/subscription/{sid}/enable` | `services/notification-subs.ts:124` | POST | WRP | |
| POST | `/subscription/{sid}/test` | `services/notification-subs.ts:148` | POST | WRP | |
| GET | `/topic/{tid}` | MISS | — | MISS | |
| GET | `/topic` | `services/notification-subs.ts:108` | `/v1/notifications/topics` | WRP | |

### Commerce / Taxonomy (`/commerce/taxonomy/v1`)

OpenAPI not bundled. Scope `api_scope` (app).

| Method | eBay path | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|
| GET | `/get_default_category_tree_id` | `services/categories.ts:28` | `/v1/categories` | OK | |
| GET | `/category_tree/{tid}` | `services/categories.ts:93` | `/v1/categories/tree/{id}` | OK | |
| GET | `/category_tree/{tid}/get_category_subtree` | `services/categories.ts:102` | `/v1/categories/{tid}/subtree` | OK | |
| GET | `/category_tree/{tid}/get_category_suggestions` | `services/categories.ts:132` | `/v1/categories/suggest` | OK | |
| GET | `/category_tree/{tid}/get_item_aspects_for_category` | `services/categories.ts:164` | `/v1/categories/{tid}/aspects` | OK | |
| GET | `/category_tree/{tid}/get_compatibility_properties` | `services/compatibility.ts:47` | `/v1/categories/{tid}/compatibility` | WRP | |
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
| GET | `/feedback` | `services/ebay/rest/feedback.ts:125` | `/v1/feedback` | OK 2026-05-02 | |
| POST | `/feedback` | `services/ebay/rest/feedback.ts:206` | `/v1/feedback` POST | WRP — POST untested | |
| GET | `/feedback_rating_summary` | MISS (verified in G.1 — scope works) | — | MISS | |
| POST | `/respond_to_feedback` | MISS | — | MISS | |

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
| POST | `/cancellation/{id}/approve` | `services/disputes/operations.ts:106` | `/v1/disputes/{id}/respond` | WRP | |
| POST | `/cancellation/check_eligibility` | `services/disputes/cancellation.ts:43` | `/v1/disputes/cancellation/eligibility` | WRP | |
| POST | `/cancellation` | `services/disputes/cancellation.ts:66` | `/v1/disputes/cancellation` | WRP | |
| GET | `/return/search` | `services/disputes/operations.ts:24` | `/v1/disputes?type=return` | OK | |
| GET | `/return/{id}` | `services/disputes/operations.ts:32` | `/v1/disputes/{id}` | OK | |
| POST | `/return/{id}/decide` | `services/disputes/operations.ts:104` | `/v1/disputes/{id}/respond` | WRP | |
| GET | `/casemanagement/search` | `services/disputes/operations.ts:25` | `/v1/disputes?type=case` | OK | |
| GET | `/casemanagement/{id}` | `services/disputes/operations.ts:33` | `/v1/disputes/{id}` | OK | |
| POST | `/casemanagement/{id}/provide_seller_response` | `services/disputes/operations.ts:105` | `/v1/disputes/{id}/respond` | WRP | |
| GET | `/inquiry/search` | `services/disputes/operations.ts:27` | `/v1/disputes?type=inquiry` | OK | |
| GET | `/inquiry/{id}` | `services/disputes/operations.ts:35` | `/v1/disputes/{id}` | OK | |
| POST | `/inquiry/{id}/provide_seller_response` | `services/disputes/operations.ts:107` | `/v1/disputes/{id}/respond` | WRP | |
| POST | `/inquiry/{id}/close` | MISS | — | MISS | |

---

### Developer (`/developer/`)

#### `/developer/analytics/v1_beta`

OpenAPI: `application-settings/developer_analytics_v1_beta_oas3.json`.

| Method | eBay path | Scope | Our wrapper | Our route | Status | Notes |
|---|---|---|---|---|---|---|
| GET | `/rate_limit/` | `api_scope` (app) | `services/me-account.ts:45` | `/v1/me/quota` | WRP | |
| GET | `/user_rate_limit/` | `sell.inventory` (user) | `services/me-account.ts:52` | `/v1/me/quota` | WRP | |

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
| GetBestOffers | `services/ebay/trading/best-offer.ts:43` | `/v1/offers` (inbound list) | OK | No REST equivalent — Negotiation REST is outbound only. |
| RespondToBestOffer | `services/ebay/trading/best-offer.ts:97` | `/v1/offers/{id}/respond` | OK | |
| VerifyAddItem | `services/ebay/trading/listing.ts:49` | sandbox sell-side workaround | OK | Sandbox Sell/Inventory deadlocks on business-policy opt-in (memory: feedback_ebay_sandbox_sell.md). Use cat 88433. |
| GetMyeBaySelling | `services/ebay/trading/myebay.ts:68` | `/v1/me/selling` | OK | Convenience read for legacy listings. |
| GetMyeBayBuying | `services/ebay/trading/myebay.ts:94` | `/v1/me/buying` | OK | No REST equivalent. |
| AddToWatchList | `services/ebay/trading/myebay.ts:112` | `/v1/watching` POST | OK | No REST watchlist write. |
| RemoveFromWatchList | `services/ebay/trading/myebay.ts:122` | `/v1/watching/{id}` DELETE | OK | |
| GetSearchResults | `services/ebay/trading/myebay.ts:151` | `/v1/saved-searches` (fallback) | WRP (best-effort, swallow errors) | Bridge is preferred — see Section 3. |
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
| EBAY_INBOX_SAVED_SEARCHES | `/v1/saved-searches` | OK | Trading `GetSearchResults` is fallback only. |
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

Wrappers that exist but aren't live-verified, or known issues that need a probe to classify:

- `/buy/offer/v1_beta/bidding/{id}` — 404 on probe; need to determine if Limited Release vs wrong path vs eBay deprecated proxy bidding entirely.
- `/sell/feed/v1/*` and `/buy/feed/v1_beta/*` — 403 "Contact Developer Technical Support" — Limited Release; need eBay app approval to use. Decide whether to apply or remove the path constants.
- `/v1/markdowns` GET/POST (`item_price_markdown`) — 400 invalid_request on probe, likely missing required `marketplace_id` query param. Trace the failing probe input and fix.
- `/v1/promotions` GET/POST (`item_promotion`) — same 400 invalid_request; same fix shape expected.
- POST `/commerce/message/v1/send_message` — wrapper exists, scope granted, never tested with a real conversation.
- POST `/commerce/feedback/v1/feedback` (leaveFeedback) — wrapper exists, scope granted, never tested.
- POST `/commerce/feedback/v1/respond_to_feedback` — not wrapped yet but probably should be.
- AAQ (Ask A Question) pre-purchase exposure — Trading distinguishes member-message types; REST may or may not show pre-purchase questions. Verify.
- `/developer/key_management/v1/signing_key/*` — not wrapped. Mandatory for some 2025+ eBay endpoints (verify which specifically). Add when first endpoint that demands it appears.
- `/sell/analytics/v1/customer_service_metric/{type}/{eval}` — path constant exists in `services/analytics.ts:102` but no caller. Either wire it or remove.
- `services/charities.ts` — both methods declared but wiring incomplete; verify against `commerce/charity` paths and live-probe.
- `/commerce/identity/v1/user/` — sanity-checked OK but no service file. Add `services/identity.ts` + `/v1/me/identity` route once a use case appears.
- `/sell/logistics/v1_beta/shipment/{id}/label` (PDF download) + `/manifest` — not wrapped. Needed for sellers who actually print labels.
- `/sell/marketing/v1/email_campaign/*` — entire surface missing.
- `/sell/marketing/v1/{negative_,}keyword*` — entire keyword surface missing (PLA campaigns).
- `/sell/account/v1/sales_tax/*` (CRUD) — only GET-list wrapped; full CRUD missing.
- `/sell/inventory/v1/bulk_create_offer` — not wrapped (bulk_create_or_replace is similar but distinct).
- `/sell/inventory/v1/location/{id}/update_location_details` — not wrapped.
- `/post-order/v2/inquiry/{id}/close` — not wrapped.
- API-status RSS feed (`https://developer.ebay.com/rss/api-status`) — not yet polled. Reference repo (`references/ebay-mcp/scripts/sync-api-status.mjs`) does it weekly. Decide cron or `/v1/health/ebay` endpoint.

---

## Section 7: How to use this file

When you change anything in `EBAY_SCOPES`, when you wrap a new endpoint, or when you discover a 4xx in production, update the relevant row. Re-run live probes by token-exchanging via `/v1/connect/ebay/start` consent flow and `curl -H "Authorization: Bearer $TOK" -H "X-EBAY-C-MARKETPLACE-ID: EBAY_US" "$EBAY_BASE_URL$PATH"` (use `Authorization: IAF $TOK` for `/post-order/v2/*`). Mark OK with the probe date in the Notes column. The Status column is the source of truth for "does this work today."

When wrapping a new endpoint:
1. Find its row in Section 1 (or add one if missing — eBay added it post-2026-04-24 OpenAPI snapshot).
2. Fill `Our wrapper` with `services/<file>.ts:LINE`.
3. Fill `Our route` with the `/v1/...` shape.
4. Set Status to WRP until you live-probe it; flip to OK with date once verified.
5. If you removed something dead, move the row to Section 5.
