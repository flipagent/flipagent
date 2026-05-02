# eBay API coverage audit
_Generated 2026-05-02 (one-off snapshot — re-run by hand if needed)._

External eBay surface compiled from the public docs via WebSearch (developer.ebay.com).
Internal usage compiled from `packages/api/src/services/**` (file:line references below).
Where developer.ebay.com pages would not load (most overview pages timed out
during this audit), API names + status come from the search-result snippets
plus the documented capability matrix in `services/shared/transport.ts`. Any
field the public docs did not confirm is marked _unverified_.

## TL;DR
- **~150 REST paths** offered across the relevant Buy/Sell/Commerce/Post-Order APIs (rough order-of-magnitude: 6 Buy APIs ≈ 25 paths, 14 Sell APIs ≈ 95 paths, 7 Commerce APIs ≈ 25 paths, Post-Order v2 ≈ 10 paths).
- **~75 REST paths** we actually hit (enumerated below); **~75 unused**, mostly inside Sell Marketing (ad reports), Inventory (variations / aspect group bulk), Browse (item-group search), Compliance details, and Notification config.
- **Trading XML calls used: 13** (covers 6 capabilities REST does not expose at all + 1 sandbox workaround).
- **Bridge tasks: 8** (4 are pure "no eBay API exists" gaps; 1 is a Limited-Release fallback; 3 are Planet Express forwarder ops, no eBay equivalent).
- **Hard "no eBay API at all" gaps** filled by bridge: Watching list read, Saved Searches read, logged-in Cases inbox, logged-in Offers inbox.
- **Approval-gated REST routed around** with scrape: Marketplace Insights (sold), Commerce Catalog. Routed around with bridge: Buy Order API (also has REST first-class behind `EBAY_ORDER_API_APPROVED`).

---

## A. REST coverage matrix

Approval column: `public` = freely available / standard onboarding, `LR` = Limited Release per eBay docs (must apply, may need contract), `app-required` = requires Partner Network application or business case.

| eBay API | Approval | Total paths (approx) | Paths we use | Paths unused | Notes / file refs |
|---|---|---|---|---|---|
| Buy / Browse | public | ~10 | 2 (`item_summary/search`, `item/{id}`, `item/{id}/check_compatibility`) | item-group search, getItems batch, get-by-legacy-id | `services/items/{search,detail,rest}.ts`, `services/compatibility.ts` |
| Buy / Marketing | public | ~3 | 0 | merchandised products, also-bought | not wired — sourcing uses search instead |
| Buy / Marketplace Insights | LR | ~1 (`item_sales/search`) | 0 (gated by `EBAY_INSIGHTS_APPROVED`; scrape carries load) | — | `services/items/sold.ts` (scrape primary); flag in `services/shared/transport.ts:73` |
| Buy / Order | LR | ~10 | 5 (`checkout_session/{id}/{shipping_address,payment_instrument,coupon×2}`) | initiate / place_order / get session — these run via REST flow but are wrapped by the orchestrator, not a separate path call | `services/purchases/orchestrate.ts:168-215`; both transports first-class per matrix line `orders.checkout` |
| Buy / Offer (proxy bidding) | LR | ~3 | 3 (`bidding`, `find_eligible_items`, `bidding/{id}/place_proxy_bid`) | none | `services/bids.ts` |
| Buy / Feed | LR / app-required | ~5 | 0 (`/buy/feed/v1_beta` referenced in `services/feeds.ts` but not actively wired) | bulk daily snapshot feeds | _unverified count_ |
| Buy / Deal | LR | ~2 (`deal_item`, `event_item`) | 2 | none | `services/featured.ts` |
| Sell / Account v1 | public | ~25 | 11 (fulfillment/payment/return policies, custom_policy, kyc, privilege, rate_table, subscription, eligibility, advertising_eligibility, sales_tax, payments_program, fulfillment_policy/{id}/transfer) | program enrollments details, opt-in calls (we sidestep) | `services/policies.ts`, `services/seller-account.ts` |
| Sell / Account v2 (Stores) | public | ~3 | 2 (GET / POST `/sell/stores/v2/store-categories`) | DELETE store-categories, store-config | `services/store.ts:33,47` |
| Sell / Inventory | public | ~30 | 14 (inventory_item CRUD, inventory_item_group, location, offer CRUD, offer/{id}/{publish,withdraw}, bulk_create_or_replace_inventory_item, bulk_get_inventory_item, bulk_get_offer, bulk_migrate_listing, bulk_publish_offer, bulk_update_price_quantity) | product compatibility, image-variation by listing, sku-locale-products | `services/listings/{create,bulk,lifecycle,get,defaults}.ts`, `services/locations.ts` |
| Sell / Fulfillment | public | ~6 | 4 (`order` list, `order/{id}`, `order/{id}/shipping_fulfillment`, `order/{id}/issue_refund`) | get-fulfillments-by-order, get-payment-dispute (in disputes service), pay-out-of-band | `services/sales/operations.ts:56,83`, `services/listings/get.ts` |
| Sell / Finances | public | ~6 | 4 (`payout`, `payout_summary`, `transaction`, `transfer`) | transaction-summary, get-payout, get-transfer-by-id | `services/money/operations.ts` |
| Sell / Marketing | public | ~25 | 8 (ad_campaign list/create/{id}/ad_group, ad, ad_report_metadata, item_promotion list/create, item_price_markdown list/create) | ad-report run/download, suggest-keywords, item-aspect-bid, video-ads, dynamic-ad-rate | `services/marketing/{ads,markdowns,promotions,reports}.ts` |
| Sell / Negotiation | public | 2 | 2 (`find_eligible_items`, `send_offer_to_interested_buyers`) | none | `services/offers.ts` |
| Sell / Analytics | public | ~5 | 2 (`traffic_report`, `seller_standards_profile/{program}/{cycle}`) | customer_service_metric (referenced as path constant but no caller wired) | `services/analytics.ts:43,73` |
| Sell / Compliance | public | ~3 | 2 (`listing_violation`, `listing_violation_summary`) | suppress-violation | `services/violations.ts` |
| Sell / Recommendation | public | 1 | 1 (`find_listing_recommendations`) | none | `services/recommendations.ts` |
| Sell / Logistics | public (v1_beta) | ~5 | 3 (`shipping_quote`, `shipment`, `shipment/{id}/cancel`) | label download, manifest | `services/labels.ts:83` |
| Sell / Metadata | public | ~10 | 3 (`get_return_policies`, `get_sales_tax_jurisdictions`, `get_digital_signature_routes`) | get_listing_structure_policies, get_country_codes, get_currencies, get_extended_producer_responsibility_policies, get_hazardous_materials_labels, get_motors_specifications, get_payment_methods, get_product_safety_labels | `services/marketplace-meta/{operations,digital-signature}.ts` |
| Sell / Feed | public | ~10 | 0 (path constant `"/sell/feed/v1"` referenced in `services/feeds.ts` but no caller invokes) | inventory feed, order feed, listing feed | unused expansion |
| Commerce / Catalog | LR | ~3 | 2 (`product/{epid}`, `product_summary/search`) — gated by `EBAY_CATALOG_APPROVED`; scrape fallback in `services/ebay/scrape/catalog.ts` | none | `services/products.ts`; matrix line `markets.catalog` (transport.ts:104) |
| Commerce / Identity | public | 1 | 0 (we read the fields via OAuth introspection / userinfo proxy, but no `/commerce/identity/v1/user/` call wired) | get user profile | unused expansion |
| Commerce / Translation | public | 1 | 0 (referenced `services/translate.ts` but no caller wires the path) | translate | wiring TBD |
| Commerce / Taxonomy | public | ~6 | 5 (`get_default_category_tree_id`, `category_tree/{id}`, `get_category_subtree`, `get_category_suggestions`, `get_item_aspects_for_category`, `get_compatibility_properties`) | get_compatibility_property_values | `services/categories.ts`, `services/compatibility.ts` |
| Commerce / Charity | public | 2 | 0 (file `services/charities.ts` exists but does not appear to call REST in current grep) | search, get-charity-org | `services/charities.ts` (_unverified — wiring incomplete_) |
| Commerce / Media | public | ~3 | 1 (`media/v1_beta/{type}/{id}`) | upload-from-url batch, list videos | `services/media.ts` |
| Commerce / Notification | public | ~7 | 4 (`destination`, `subscription`, `topic`, `subscription/{id}` DELETE) | get-subscription, enable/disable subscription, get-public-key | `services/notification-subs.ts:73`, `services/notifications/dispatch.ts` |
| Post-Order v2 | public | ~10 | 0 (REST disputes service uses Sell Account dispute paths — see `services/disputes/operations.ts:126`; Post-Order v2 cancellation/return/inquiry paths are not wired) | cancellation/{id}, search, check_eligibility, return/{id}, inquiry/{id}, close inquiry | unused expansion (we route disputes through Sell Fulfillment payment_dispute + Trading where needed) |
| Developer / Analytics (rate-limit) | public | 1 | 0 | get_rate_limits | unused expansion |

Subtotals (approx, ignoring _unverified_ entries): ~150 paths offered, ~73 used, ~77 unused.

---

## B. Trading XML usage

| Verb | Used? | Why (vs REST)? |
|---|---|---|
| GetMyMessages | yes (`services/ebay/trading/messages.ts:51`) | No REST equivalent — Sell Messaging API is Trading-only. |
| AddMemberMessageRTQ | yes (`messages.ts:110`) | No REST equivalent — Trading-only buyer reply. |
| GetBestOffers | yes (`best-offer.ts:43`) | Inbound best-offer surface has no REST equivalent (Negotiation API is outbound seller→buyer only). |
| RespondToBestOffer | yes (`best-offer.ts:97`) | Same — accept/decline inbound best offers, Trading-only. |
| GetFeedback | yes (`feedback.ts:42`) | No REST feedback API. |
| LeaveFeedback | yes (`feedback.ts:82`) | No REST feedback API. |
| GetItemsAwaitingFeedback | yes (`feedback.ts:109`) | No REST equivalent. |
| VerifyAddItem | yes (`listing.ts:49`) | Sandbox sell-side workaround — Sell Inventory deadlocks on business-policy opt-in in sandbox; Trading AddFixedPriceItem path used as escape hatch (memory: `feedback_ebay_sandbox_sell.md`). |
| GetMyeBaySelling | yes (`myebay.ts:68`) | Convenience read for legacy listing IDs — also useful when Inventory API doesn't expose items created outside the Inventory model. |
| GetMyeBayBuying | yes (`myebay.ts:94`) | No REST "my buying" surface. |
| AddToWatchList | yes (`myebay.ts:112`) | No REST watchlist write. |
| RemoveFromWatchList | yes (`myebay.ts:122`) | No REST watchlist write. |
| GetSearchResults | yes (`myebay.ts:151`) | Saved-searches read fallback (we prefer bridge — see Section C). |
| SetNotificationPreferences | yes (`services/notifications/ebay-trading.ts:73`) | Trading is the supported pipe for the wider notification topic set; Commerce/Notification covers a subset only. |
| GetNotificationPreferences | yes (`ebay-trading.ts:98-99`) | Same. |
| GetCategories | yes (`services/ebay/trading/categories.ts:38`) | Used as Taxonomy fallback for legacy category data shapes. |

**Verbs available but unused that look interesting:**
- `GetSellerEvents` / `GetSellerList` — full historical inventory pull
- `GetItemTransactions` / `GetSellerTransactions` — pre-Finances API order pull
- `AddSecondChanceItem` — convert losing-bidder offers to BIN
- `GetAccount` — Trading-side seller statement
- `GetCategoryFeatures` — per-category capability matrix richer than Metadata API
- `EndFixedPriceItem` / `EndItems` — Trading-side mass-end (we use Sell Inventory `withdraw`)

---

## C. Real gaps — eBay provides NOTHING, we built it ourselves

| Capability | Our solution | File |
|---|---|---|
| Watch List read (the buyer-facing list of items they're watching) | bridge task `EBAY_INBOX_WATCHING` | `services/ebay/bridge/tasks.ts:21`, matrix `inbox.watching` (`transport.ts:130`) |
| Saved Searches read | bridge task `EBAY_INBOX_SAVED_SEARCHES` (Trading `GetSearchResults` is a fallback only) | `tasks.ts:24`, matrix `inbox.savedSearches` (`transport.ts:133`) |
| Logged-in Cases inbox (the seller's "Resolution Center" surface — INR cases, returns, eBay-mediated cases shown in one list) | bridge task `EBAY_INBOX_CASES` | `tasks.ts:23`, matrix `inbox.cases` (`transport.ts:132`) |
| Logged-in Offers inbox (incoming best-offers as the seller sees them in My eBay, with thread state + counters) | bridge task `EBAY_INBOX_OFFERS` (Trading `GetBestOffers` covers offer existence; the inbox-shape view is bridge-only) | `tasks.ts:22`, matrix `inbox.offers` (`transport.ts:131`) |
| Synchronous DOM primitives (click/scroll/screenshot inside the user's session) | bridge task `BROWSER_OP` | `tasks.ts:30`, surface `/v1/browser/*` |
| Package forwarder ops (Planet Express): pull packages list, photo request, dispatch | bridge tasks `pull_packages`, `planetexpress_package_photos`, `planetexpress_package_dispatch` | `tasks.ts:26-28`, surface `/v1/forwarder/planetexpress/*` |

(Note: forwarder ops are not really an "eBay gap" — Planet Express has no public API at all, so the forwarder uses the bridge for the same reason buy-side uses it.)

---

## D. Approval-gated REST we route around

| eBay API | Gate | Our fallback | File |
|---|---|---|---|
| Buy / Marketplace Insights (sold-comps search) | `EBAY_INSIGHTS_APPROVED` env flag (LR) | scrape (primary path) | `services/items/sold.ts`, matrix `listings.sold` (`transport.ts:73`) |
| Buy / Order | `EBAY_ORDER_API_APPROVED` env flag (LR) | bridge task `EBAY_BUY_ITEM` (first-class equal sibling, not "fallback") | `services/purchases/orchestrate.ts`, matrix `orders.checkout` (`transport.ts:84`) |
| Commerce / Catalog (`product_summary/search`, `product/{epid}`) | `EBAY_CATALOG_APPROVED` env flag (LR) | scrape (`/p/{epid}` JSON-LD + item-specifics) | `services/ebay/scrape/catalog.ts`, matrix `markets.catalog` (`transport.ts:104`) |

`selectTransport` (`services/shared/transport.ts:175-235`) handles the gate-flag lookup uniformly — when the flag is unset, REST is filtered out of the candidate set and the next available transport (scrape or bridge) is selected automatically.

---

## E. Endpoints eBay offers that we DON'T use yet (potential expansion)

**Buy:**
- Browse: `getItems` (batch get up to 20 items in one call), `getItemByLegacyId`, item-group search
- Marketing: merchandised-products, also-bought, top-products
- Feed: bulk daily snapshot feeds (would unlock category-wide cold-start indexing)

**Sell:**
- Inventory: product-compatibility for parts/motors, locale-specific product info, image variation by listing
- Marketing: `runReport` + `getReportTask` (scheduled ad-performance reports), suggest-keywords, video-ad surfaces, dynamic-ad-rate, item-aspect-bid
- Analytics: customer_service_metric (referenced as path constant in `services/analytics.ts` but no caller — looks like wiring abandoned mid-implementation)
- Metadata: `get_listing_structure_policies`, `get_country_codes`, `get_currencies`, `get_extended_producer_responsibility_policies`, `get_hazardous_materials_labels`, `get_motors_specifications`, `get_payment_methods`, `get_product_safety_labels` (most are reference data — could be cached app-wide once)
- Feed: full Sell Feed API surface — bulk listing/order/inventory feeds. Would let big sellers replace per-item REST writes with daily feeds.
- Logistics: label download, manifest endpoints (we create the shipment but don't pull the PDF/png label or build manifests)
- Account v1: program-enrollment opt-in calls (we deliberately don't call these from the agent path; could be exposed as `/v1/me/account/opt-in`)

**Commerce:**
- Identity: `getUser` — useful as a once-per-key seller profile lookup
- Translation: actual `translate` POST — service file exists but no wiring
- Charity: search + get-charity-org (`services/charities.ts` is a stub)
- Notification: `getSubscription`, `enable/disableSubscription`, `getPublicKey` (we POST destinations + subscriptions but don't read them back)
- Media: list-videos, upload-from-url batch

**Post-Order v2:**
- Entire surface unused — cancellation create/get/search/eligibility, return create/get/search, inquiry create/get/close. Today, dispute handling routes through Sell Fulfillment's `payment_dispute` shape (`services/disputes/operations.ts:126`) which doesn't cover buyer-initiated INR/Return cases. Wiring Post-Order would close the buyer-side dispute gap.

**Developer:**
- `developer/analytics` rate-limit lookup — easy +1 for `/v1/me/quota` style introspection.

---

## F. Sources

- https://developer.ebay.com/api-docs/static/openapi-contracts.html — OpenAPI contract index (intended root, fetched via search snippets; direct WebFetch timed out 2026-05-02)
- https://developer.ebay.com/api-docs/buy/static/buy-overview.html — Buy APIs overview (Limited Release language quoted)
- https://developer.ebay.com/api-docs/buy/browse/overview.html — Browse API
- https://developer.ebay.com/api-docs/buy/marketplace-insights/static/overview.html — Marketplace Insights (LR)
- https://developer.ebay.com/api-docs/sell/inventory/overview.html — Sell Inventory
- https://developer.ebay.com/api-docs/sell/fulfillment/overview.html — Sell Fulfillment
- https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html — Commerce Taxonomy
- https://developer.ebay.com/develop/apis/restful-apis/sell-apis — Sell APIs index
- https://developer.ebay.com/develop/api/sell/charity_api — Charity API
- https://developer.ebay.com/devzone/post-order/index.html — Post-Order API index
- https://developer.ebay.com/devzone/xml/docs/Reference/eBay/index.html — Trading API reference index (verbs)
- https://developer.ebay.com/devzone/xml/docs/reference/ebay/additem.html — Trading AddItem
- https://developer.ebay.com/devzone/xml/docs/Reference/eBay/GetMyMessages.html — Trading GetMyMessages
- Internal: `packages/api/src/services/shared/transport.ts` (capability matrix), `packages/api/src/services/ebay/bridge/tasks.ts` (bridge task list), all `services/**/*.ts` for path enumeration.

Fetched 2026-05-02. Many developer.ebay.com overview pages timed out on direct WebFetch; data was reconstructed from search-result snippets cross-referenced against the in-repo capability matrix, which is authoritative for our usage side.

---

## G. Cross-check vs `YosefHayim/ebay-mcp` reference (2026-05-02)

Cloned to `references/ebay-mcp/` (gitignored). Their repo: 325 MCP tools claiming "100% Sell-side coverage", typed against actual eBay OpenAPI 3.0 contracts (`docs/sell-apps/*_oas3.json`). Comparing their wrapped paths against our service files surfaced several **wrong claims in Sections B/D above** plus several real gaps.

### G.1 Things our MD got wrong — eBay added REST equivalents (verified live 2026-05-02)

End-to-end verified against `api.ebay.com` with a real user OAuth token (sprd-shop account, scopes added: `commerce.message`, `commerce.feedback`):

| Endpoint | Scope | Verified result |
|---|---|---|
| `GET commerce/feedback/v1/feedback_rating_summary?user_id=X&filter=ratingType:Y` | `commerce.feedback.readonly` (app token works) | ✅ HTTP 200, real seller summary |
| `GET commerce/feedback/v1/awaiting_feedback` | `commerce.feedback` (user token) | ✅ HTTP 200, returns awaiting items + **full DSR 4-rating template** (item description / shipping cost / shipping time / communication) — feature-equivalent to Trading `GetItemsAwaitingFeedback` |
| `GET commerce/message/v1/conversation?limit=N` | `commerce.message` (user token) | ✅ HTTP 200, returns 30 conversations including `conversationType: FROM_EBAY` system notifications (return shipped, payment charged, draft listing reminders, discount offers) |
| `GET commerce/identity/v1/user/` (sanity check) | `commerce.identity.readonly` (already in `EBAY_SCOPES`) | ✅ HTTP 200, returns business profile |

**Both `commerce.message` and `commerce.feedback` are pre-granted to our app** — no developer-portal application needed. Adding them to `EBAY_SCOPES` and re-consenting users is the entire migration cost.

### G.1.1 Corrections to my earlier "냉정한 비교"

| Earlier claim | Verified reality |
|---|---|
| "REST `commerce/message/v1` is almost certainly a strict subset of Trading — no system messages, no AAQ" | False. `conversationType: FROM_EBAY` confirms eBay system notifications (returns, payments, listing reminders, discounts) are in REST. Strictly broader than I assumed. |
| "REST feedback will lack DSRs" | False. `awaiting_feedback` returns the full 4-DSR template (item-as-described, shipping cost, shipping time, communication) with the same `acceptableValues` enum Trading uses. |
| "Scope likely needs application via eBay developer support" | False. Both scopes were already granted to client_id `OSDesign-SPRD-PRD-...` without ever filing a request. |

### G.1.2 What is still unverified

The following are **probable** but not directly probed yet:

- `POST commerce/message/v1/send_message` (writing) — endpoint exists, scope granted, but no test send made
- `POST commerce/feedback/v1/feedback` (leaving feedback) — same
- `POST commerce/feedback/v1/respond_to_feedback` — same
- AAQ (Ask A Question) pre-purchase exposure — Trading distinguishes member-message types; REST may or may not show pre-purchase questions
- Folder / search filtering parity — Trading `GetMyMessages` has folder filter; REST appears to be paginated-flat list only

### G.1.3 Migration shipped 2026-05-02 (commits `d9e0dba`, `6a9dfc6`)

REST `commerce/message/v1` + `commerce/feedback/v1` are now the primary path. Trading XML modules deleted. `/v1/messages` redesigned around eBay's conversation-threaded shape (3 handlers: list / thread / send) instead of the Trading-era flat `Message[]`. `/v1/feedback` shape unchanged externally; internals swapped. SDK + MCP tools + CLI updated.

Re-consent required: existing users' OAuth tokens lack `commerce.message` + `commerce.feedback` scopes; next `/v1/connect/ebay/start` will request them.

Still untested in production: POST writes (send_message, leave feedback, respond_to_feedback) — endpoints exist + scope granted, but no live POST executed. AAQ pre-purchase exposure unverified.

### G.2 Whole eBay APIs we don't touch at all

| eBay API | Why it matters | Reference file |
|---|---|---|
| **`commerce/vero/v1`** — VeRO (Verified Rights Owner) | IP/copyright takedown surface. Distinct from our `/v1/takedown` (which is seller opt-out of *our scrape*). Lets a rights-holder file/track takedowns through eBay. | `references/ebay-mcp/src/api/other/vero.ts` |
| **`developer/`** rate-limit + signing-key APIs | `GET /rate_limit/`, `GET /user_rate_limit/` → quota introspection (perfect for `/v1/me/quota`). `GET/POST /signing_key` → digital-signature key mgmt (mandatory for some 2025+ eBay endpoints) | `references/ebay-mcp/src/api/developer/developer.ts` |

### G.3 APIs we cover thinly — large endpoint gaps

| Resource | We have | Reference has additionally | Highest-value adds |
|---|---|---|---|
| Sell Marketing | ~8 paths | 30+ paths: bulk_create/delete/update_ads_by_listing_id, bulk_create_ads_by_inventory_reference, ad_campaign clone/end/pause/resume, get_campaign_by_name, ad/{id}/update_bid, get_ads_by_listing_id, get_ads_by_inventory_reference | bulk ad ops + campaign lifecycle (pause/resume) — agents managing 100s of listings need bulk |
| Sell Inventory | 15 paths (`get_listing_fees` shipped commit `6a9dfc6`) | `POST /bulk_publish_offer`, `listing/{id}/sku/{sku}/locations` CRUD, `offer/publish_by_inventory_item_group`, `offer/withdraw_by_inventory_item_group`, `location/{id}/{enable,disable}`, `location/{id}/update_location_details`, product_compatibility CRUD | bulk publish + multi-warehouse location attach |
| Sell Account | 11 paths | `POST /program/{opt_in,opt_out}`, `GET /program` (program enrollment), payment_policy/return_policy/fulfillment_policy `_by_name` lookups | program opt-in opens managed-payments / advertising onboarding via API |
| Sell Metadata | 3 paths | 17+ paths per marketplace: get_category_policies, get_listing_structure_policies, get_extended_producer_responsibility_policies (EU EPR mandatory), get_hazardous_materials_labels, get_product_safety_labels, get_product_compliance_policies, get_regulatory_policies, get_motors_listing_policies, get_currencies, get_shipping_policies, get_site_visibility_policies, compatibilities/* (5 paths) | EU EPR + product safety labels are **legally required** for EU listings post-2025 |
| Sell Logistics (eDelivery) | 3 paths | `actual_costs`, `address_preference` GET/POST, `consign_preference` GET/POST, `agents`, `battery_qualifications`, `dropoff_sites`, `services`, `bundle` GET/POST | international shipping (consignment, dropoff sites, battery shipping qualifications) |
| Sell Negotiation | 2 paths | `GET /offer`, `GET /offer/{offerId}` (read back outbound offer status) | we send offers but can't see if buyer responded — UX gap |
| Sell Fulfillment / Disputes | search + get-by-id | `payment_dispute/{id}/activity` (history), `payment_dispute/{id}/contest`, `accept_payment_dispute`, `add_evidence`, `update_evidence`, `fetch_evidence_content` | full dispute response lifecycle — currently agents can read disputes but cannot respond |
| Commerce Notification | 4 paths | 15+ paths: subscription full CRUD, subscription/{id}/{enable,disable,test}, subscription/{id}/filter CRUD, config GET/PUT, public_key/{id}, topic, topic/{id} | filter mgmt + test endpoint = critical for webhook debugging |
| Commerce Taxonomy | 5 paths | `get_compatibility_property_values` (we have property_names but not values) | parts/motors compatibility completion |
| Sell Analytics | 2 paths | `customer_service_metric/{type}/{eval}` (path constant exists in our code but no caller wired) | seller standards monitoring |

### G.4 Our existing strengths the reference DOESN'T have

The reference is sell-only — no Buy-side coverage at all. Our edge:

- All Buy APIs (Browse, Marketplace Insights, Order, Offer, Feed, Deal) — they have none
- Bridge transport for Buy Order + inbox surfaces — they don't have Chrome extension
- Scrape fallbacks for LR-gated APIs — they 401 on un-approved keys
- `commerce/charity` — they don't wrap it either, so this is a mutual gap
- MCP-vs-API split with managed scoring — they're a thin Sell wrapper

### G.5 The "is this endpoint up" answer

The reference answers our earlier "어떻게 알 수 있나" question concretely: **eBay publishes an RSS feed of API status** at `https://developer.ebay.com/rss/api-status`. Their `scripts/sync-api-status.mjs` polls it weekly and writes `docs/API_STATUS.md`. Our equivalent would be a cron sync into `notes/ebay-api-status.md`, or a `/v1/health/ebay` endpoint that fronts the feed.

### G.6 Prioritised follow-ups (sorted by user-visible impact)

**Done this session:**
- ✅ REST messaging + feedback migration — `commit d9e0dba`
- ✅ `offer/get_listing_fees` wrapped as `/v1/listings/preview-fees` — `commit 6a9dfc6`

**Important correction on `get_listing_fees`** (verified live 2026-05-02 with both APIs):
Both REST `get_listing_fees` AND Trading `VerifyAddItem` return only **listing-time fees** (InsertionFee, BoldFee, GalleryFee, ProPackBundleFee, ~27 categories). **Neither returns FinalValueFee** (eBay's main ~13.25% commission). FVF is charged at sale time, not listing time, so it's outside both APIs' scope.

→ `get_listing_fees` is **NOT an evaluator margin upgrade**. Our `quant/fees.ts` static `feeRate: 0.1325` remains the correct model for FVF. `/v1/listings/preview-fees` is useful only for "what insertion + ad fees will I pay on these N drafts I've already created" — not "what's my net after sale".

**Next priorities (re-ranked after the FVF discovery):**

1. **Dispute response lifecycle** — contest / accept / add_evidence / fetch_evidence_content on `/sell/fulfillment/v1/payment_dispute/{id}`. Today agents can READ disputes but not respond — biggest user-visible gap. Verified live: scope `sell.fulfillment` already granted to our app.
2. **Negotiation read-back** — `GET /sell/negotiation/v1/offer` + `/offer/{id}`. Today we send offers but can't see if buyer responded.
3. **Sell Metadata EU EPR + product safety** — `get_extended_producer_responsibility_policies`, `get_product_safety_labels`, `get_regulatory_policies`. Legally required for EU listings post-2025.
4. **Developer rate-limit** as `/v1/me/quota` — quota introspection. Small but useful.
5. **Bulk Marketing ad ops** — bulk_create/delete/update_ads_by_listing_id, campaign clone/end/pause/resume. For agents managing many listings.
6. **VeRO API** — `commerce/vero/v1` for sellers fielding IP claims (also our own takedown could route here).
7. **Notification subscription enable/disable/test/filter** — webhook debugging.
8. **Post-Order v2** (cancellation/return/inquiry) — currently we route disputes through Sell Fulfillment payment_dispute only; Post-Order would close the buyer-initiated INR/Return gap.

**De-prioritised:**
- ~~Migrate POST messages/feedback writes~~ — endpoints already wired in commit `d9e0dba`; just unverified live. Smoke-test by sending a test message rather than fresh code.
- ~~`offer/get_listing_fees` in evaluator~~ — wrong tool for that job (see correction above).

### G.7 Reference paths

- Repo: `references/ebay-mcp/` (gitignored under `references/` in `.gitignore:31`)
- Tool definitions: `references/ebay-mcp/src/tools/definitions/{account,inventory,marketing,fulfillment,analytics,communication,taxonomy,metadata,developer,trading,token-management}.ts`
- API clients: `references/ebay-mcp/src/api/{account-management,listing-management,marketing-and-promotions,order-management,analytics-and-report,communication,listing-metadata,other,developer,trading}/`
- Status sync: `references/ebay-mcp/docs/API_STATUS.md` + `scripts/sync-api-status.mjs`
- Their compliance notes: `references/ebay-mcp/EBAY_COMPLIANCE.md`
