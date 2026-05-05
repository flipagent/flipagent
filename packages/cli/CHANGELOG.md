# flipagent-cli

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

### Patch Changes

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
