# @flipagent/sdk

## 1.2.1

### Patch Changes

- 30aae08: Drop `recent14dMedianCents` from `MarketStats` and `SoldDigest`. Anchor selection collapses to the full-window median; callers control recency via `lookbackDays`. The recent-14d cutoff was statistically thin (4–7 obs) and pulled the anchor between price clusters in bimodal pools without giving an honest "current market" signal.
- Updated dependencies [30aae08]
  - @flipagent/types@1.4.0

## 1.2.0

### Minor Changes

- c9cf8bd: Risk-aware evaluate: replace `expectedNetCents` single number with three honest numbers — `successNetCents` (happy path), `expectedNetCents` ((1−P_fraud) × success − P_fraud × maxLoss), `maxLossCents` (worst case). Add `risk` block carrying `P_fraud`, `withinReturnWindow`, `cycleDays`, `reason`. Rating narrows from `"buy" | "hold" | "skip"` to `"buy" | "skip"` — no middle ground; expected-net floor decides. `recommendedExit.dollarsPerDay` is now denominated over the FULL buy→cash cycle (~11d overhead + sell-leg) so fast SKUs no longer look disproportionately efficient. Removes deprecated `EvaluateOpts.expectedSaleMultiplier` and `maxDaysToSell` (both no-ops post-refactor).

### Patch Changes

- Updated dependencies [c9cf8bd]
  - @flipagent/types@1.3.0

## 1.1.0

### Minor Changes

- 9d1cac5: **Marketplace literal moves to provider+region combined (`ebay_us`).**

  The `Marketplace` literal in `@flipagent/types` narrows from
  `"ebay" | "amazon" | "mercari" | "poshmark"` to `"ebay_us"`. The new
  convention is snake_case `provider_region` — `ebay_us`, `ebay_gb`,
  `stockx`, `amazon_us`, `mercari_jp`, etc. The literal expands here
  when an adapter+region combo ships; today only `ebay_us` is wired.

  **Why** — the previous union pre-declared three adapters that were
  never implemented (silent failure mode: validation accepts the value,
  the dispatcher routes nowhere). Worse, it omitted the _real_ axis the
  codebase actually needed — eBay region (`EBAY_US` vs `EBAY_GB` vs …) —
  and conflated it with the provider switch on the categories route,
  producing a 422 at the eBay marketplace_id validator. Splitting
  provider+region into one literal is more honest about today's reality
  and forward-compat for the multi-marketplace direction.

  **Wire shape**:

  - All response records that carry `marketplace` now stamp `"ebay_us"`
    in place of `"ebay"` (Item, Listing, Sale, Purchase, Payout,
    Transaction, Offer, Bid, Dispute, Feedback, Message, Promotion,
    Markdown, Ad, Recommendation, Violation, Product, Cart, Feed,
    Custom/Selling Policy, RateTable, Analytics rows).
  - Input `marketplace?: Optional(Marketplace)` fields keep their place
    on `*Query` / `*Create` schemas — they're the dispatch knob for the
    one-API surface; today only `ebay_us` is a valid value, the literal
    expands when more adapters ship.
  - The eBay-internal `X-EBAY-C-MARKETPLACE-ID` header is no longer
    read on any `/v1/*` route. Every route translates the flipagent
    literal to the eBay marketplace_id at the adapter boundary via
    `services/shared/marketplace.ts:ebayMarketplaceId(literal)`.

  **Bug fixed**: `/v1/categories` previously sent the flipagent enum
  value to eBay's `commerce/taxonomy` `marketplace_id` query param,
  which eBay rejects. The route now follows the same convention as
  every other route + has a region-keyed cache for the category-tree id.

  **`@flipagent/sdk`** — `client.categories.itemAspects(opts?)` now
  types `opts.marketplace` as `Marketplace` (was `string`). All
  namespace clients keep working unchanged; only the `marketplace`
  discriminator on records changes value.

  **`flipagent-mcp`** — taxonomy tool defaults updated (`marketplace`
  default `"ebay_us"`). Tool descriptions reference the new literal.

  The narrowed literal is the right shape for the multi-marketplace
  direction: when StockX / eBay GB / Amazon adapters land, each ships
  its literal alongside its `services/<provider>/` adapter — no schema
  churn for callers, just one new union member.

### Patch Changes

- Updated dependencies [9d1cac5]
  - @flipagent/types@1.1.0

## 1.0.0

### Major Changes

- e120fa4: **Breaking: `/v1/messages` redesigned around eBay's conversation-threaded model.**

  Previously `/v1/messages` returned a flat `Message[]` (Trading XML
  GetMyMessages-shaped). It now returns `Conversation[]` matching
  eBay's REST `commerce/message/v1` model. Three handlers replace
  the old flat-list:

  GET /v1/messages → list conversations
  GET /v1/messages/{id}?type=… → fetch the messages within one thread
  POST /v1/messages → send into existing thread (or open one)

  **SDK**: `client.messages.list()` now returns `ConversationsListResponse`
  (was `MessagesListResponse`). New methods `client.messages.thread(id, query)`
  and `client.messages.send(MessageSendRequest)` (replaces the old
  `send(MessageCreate)` shape — now requires `conversationId` OR
  `otherPartyUsername` + `messageText`).

  **MCP tools renamed**:

  - `flipagent_list_messages` → `flipagent_list_conversations`
  - new: `flipagent_get_conversation_thread`
  - `flipagent_send_message` body shape changed (see SDK)

  **CLI**: `flipagent messages` flags changed from `--unread`/`--direction`/
  `--subject` to `--type from_ebay|from_members`, `--conversation`/`--to`,
  `--listing`. New `flipagent messages thread <id> --type <…>`.

  **OAuth scopes added**: `commerce.message`, `commerce.feedback`. Existing
  connected users will need to re-consent on next `/v1/connect/ebay/start`.

  `/v1/feedback/*` migrated to REST internally too — external shape
  unchanged.

### Minor Changes

- e120fa4: **Add ~50 new eBay endpoints across 6 batches.**

  Closes the long tail of eBay APIs we'd been ignoring. Tier 1+2 of the
  ebay-mcp coverage gap analysis (notes/ebay-coverage.md) now wrapped:

  - **Caller side**: `/v1/me/quota` (Developer Analytics rate-limit
    introspection), `/v1/me/programs` (seller program enrollment +
    opt-in/out), `flipagent_translate` MCP tool.
  - **Notifications**: subscription enable/disable/test, filter CRUD,
    config GET/PUT, public_key fetch (8 new endpoints — webhook
    debugging surface).
  - **Inventory**: item-group bulk publish/withdraw, product
    compatibility CRUD, SKU-level multi-warehouse locations.
  - **Marketing**: campaign lifecycle (pause/resume/end/clone),
    per-ad bid update, bulk ad ops by listingId AND inventoryReferenceId,
    ad report download.
  - **Disputes**: payment-dispute lifecycle (accept/contest with revision
    - activity history), seller-initiated cancellation create + eligibility
      check, multipart evidence upload + binary content download.
  - **Stores**: `GET /v1/store` for store metadata (backed by Trading
    `GetStore` since Sell Stores REST is gated behind app-level approval
    we don't have).
  - **Listings**: `/v1/listings/preview-fees` (Sell Inventory
    get_listing_fees for unpublished offer drafts), policy `_by_name`
    lookups.

  **OAuth scope additions**: `sell.marketing` + `sell.marketing.readonly`
  (needed for Promoted Listings — the existing marketing surface had
  been silently 403-ing because the scope was missing). Re-consent
  required on next `/v1/connect/ebay/start`.

  **Bug fix included**: `sellRequest` now uses `Authorization: IAF` for
  `/post-order/v2/*` paths instead of `Authorization: Bearer`. The Bearer
  mismatch had been silently dropping `/v1/disputes` reads for return /
  case / cancellation / inquiry types (they 401'd, the `.catch(() => null)`
  swallowed it). Sellers triaging buyer-initiated returns through our
  API would previously have seen "no disputes" even when their inbox
  was full.

  Trading XML usage reduced to: `best-offer.ts` (in/out, no REST
  equivalent), `listing.ts` (`VerifyAddItem` — REST `get_listing_fees`
  is strict subset), `myebay.ts` (Watch / MyeBay Buying / Saved Searches —
  no REST). Trading messages, feedback, and categories deleted.

- 32cb291: **Progressive evaluate event channel + live consumer in the SDK.**

  The evaluate pipeline now emits two parallel channels — step lifecycle
  events for trace observability, and typed `partial` events that carry
  incremental `EvaluatePartial` patches as state advances (item, raw
  sold/active pools, preliminary digest, filter progress, confirmed
  digest, evaluation). UI consumers spread the patches into outcome
  state with no client-side projection.

  **`@flipagent/types`** — new exports:

  - `EvaluatePartial` schema + type — the incremental snapshot shape
    (item, soldPool, activePool, market, sold, active, filter,
    filterProgress, returns, meta, evaluation, preliminary).
  - `FilterProgress` schema + type — `{processed, total}` chunk
    counter the matcher streams during the LLM same-product filter.
  - `EvaluateJob.partial` — new field on the existing schema. Carries
    the merged `EvaluatePartial` accumulated from every partial event
    the worker has emitted so far. Polling consumers can render
    progressive UI off `GET /v1/evaluate/jobs/{id}` without subscribing
    to SSE.

  **`@flipagent/sdk`** — new exports:

  - `streamEvaluateJob({jobId, fetcher, signal, timeoutMs?})` —
    auth-agnostic async iterator yielding
    `{kind: "step" | "partial" | "done" | "error" | "cancelled"}`.
    Wraps the SSE stream + collapses `started → succeeded | failed`
    into a single `EvaluateStep` per key, with a polling fallback when
    the response isn't `text/event-stream`.
  - `describeEvaluatePhase(partial, pending)` — single label source
    every UI surface uses for the human-readable phase string
    (`Looking up listing…`, `Verifying matches · 32/150`,
    `Crunching the numbers…`, …).
  - New types: `EvaluateStep`, `EvaluateStreamEvent`,
    `EvaluateStreamError`, `EvaluateStreamOptions`, `StreamFetcher`.
  - New subpath exports `@flipagent/sdk/streams` and
    `@flipagent/sdk/phase` so consumers can import only what they
    need without dragging in unrelated namespace clients
    (e.g. avoids `node:crypto` reaching the browser bundle).
  - `client.evaluate.jobs.stream(id, opts?)` — convenience method on
    the bearer-token client that wires the SDK fetcher into
    `streamEvaluateJob` for you.

  The wire format is additive — existing consumers keep working. No
  breaking changes.

### Patch Changes

- Updated dependencies [e120fa4]
- Updated dependencies [32cb291]
- Updated dependencies [e120fa4]
  - @flipagent/types@1.0.0
