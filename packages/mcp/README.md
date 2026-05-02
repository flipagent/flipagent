# flipagent-mcp

MCP server that gives Claude Desktop, Cursor, Cline, Zed, Continue,
Windsurf, and any other MCP-compatible client a one-stop reseller API.

```bash
npm install -g flipagent-mcp
```

Easiest path is the bundled installer:

```bash
npx -y flipagent-cli init --mcp
```

Auto-detects every supported client and writes the config in one go.

## 30-second setup (Claude Desktop, manual)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"flipagent": {
			"command": "npx",
			"args": ["-y", "flipagent-mcp"],
			"env": {
				"FLIPAGENT_API_KEY": "fa_free_xxx_get_from_flipagent.dev"
			}
		}
	}
}
```

Restart Claude Desktop. The 108 tools below appear in any chat.

## Without anything (mock mode)

```json
"env": { "FLIPAGENT_MCP_MOCK": "1" }
```

Tools return canned responses so you can verify the wiring before signing up.

## Tools

All tools call the unified `/v1/*` surface at `api.flipagent.dev`.

Tool names follow `flipagent_<resource>_<verb>`, mirroring the
`/v1/<resource>/<verb>` route surface and the `client.<resource>.<verb>()`
SDK shape (dots → underscores). Marketplace stays a *parameter*, never
part of the tool name — the same tools work as Amazon and Mercari
adapters land.

### Marketplace data

| Tool | Backed by |
|---|---|
| `flipagent_items_search` | `GET /v1/items/search` |
| `flipagent_items_get` | `GET /v1/items/{itemId}` |
| `flipagent_items_search_sold` | `GET /v1/items/search?status=sold` |
| `flipagent_categories_list` | `GET /v1/categories?marketplace={id}&parentId={?}` |
| `flipagent_categories_suggest` | `GET /v1/categories/suggest?q={query}` |
| `flipagent_categories_aspects` | `GET /v1/categories/{id}/aspects` |
| `flipagent_capabilities` | `GET /v1/capabilities` |

`flipagent_categories_list` accepts an optional `parentId` so agents can
walk the tree (root → children → leaf) the same way the playground does.

### Decisions / Operations (server-side scoring)

| Tool | Backed by |
|---|---|
| `flipagent_evaluate` | `POST /v1/evaluate` — composite (detail → search sold + active → LLM same-product filter → score) |
| `flipagent_ship_quote` | `POST /v1/ship/quote` |
| `flipagent_ship_providers` | `GET /v1/ship/providers` |
| `flipagent_expenses_record` / `_summary` | `POST /v1/expenses/record` / `GET /v1/expenses/summary` |

Same-product filtering uses an LLM internally — set `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GOOGLE_API_KEY` on the API server to enable. When
no provider is configured, the composite endpoints fall back to the raw
sold + active pools (looser, evaluations still run).

### Sell-side (eBay OAuth required)

Run `/v1/connect/ebay` once to bind your eBay seller account, then:

| Tool | Backed by |
|---|---|
| `flipagent_connect_ebay_status` | `GET /v1/connect/ebay/status` |
| `flipagent_listings_create` | `POST /v1/listings` |
| `flipagent_listings_update` | `PATCH /v1/listings/{sku}` |
| `flipagent_listings_relist` | `POST /v1/listings/{sku}/relist` |
| `flipagent_sales_list` | `GET /v1/sales` |
| `flipagent_sales_ship` | `POST /v1/sales/{id}/ship` |
| `flipagent_payouts_list` | `GET /v1/payouts` |

### Buy ordering + bridge surfaces

The `/v1/purchases` surface runs in two transports — REST passthrough (with eBay's Buy Order API approval, `EBAY_ORDER_API_APPROVED=1`) or bridge (the Chrome extension navigates the listing in your real Chrome session; you click Buy It Now + Confirm-and-pay yourself, the extension records the result). Same response shape either way; pick per call with `?transport=rest|bridge` or let the capability matrix decide. Forwarder ops (`/v1/forwarder/*`) and browser DOM queries (`/v1/browser/*`) are bridge-only — they read from the user's logged-in sessions through the extension.

| Tool | Backed by |
|---|---|
| `flipagent_purchases_create` | `POST /v1/purchases` (one-shot) |
| `flipagent_purchases_get` | `GET /v1/purchases/{id}` |
| `flipagent_purchases_cancel` | `POST /v1/purchases/{id}/cancel` (bridge transport only) |
| `flipagent_forwarder_refresh` | `POST /v1/forwarder/{provider}/refresh` |
| `flipagent_forwarder_packages_photos` | `POST /v1/forwarder/{provider}/packages/{packageId}/photos` |
| `flipagent_forwarder_packages_dispatch` | `POST /v1/forwarder/{provider}/packages/{packageId}/dispatch` |
| `flipagent_forwarder_packages_link` | `POST /v1/forwarder/{provider}/packages/{packageId}/link` |
| `flipagent_forwarder_inventory_list` | `GET /v1/forwarder/{provider}/inventory` |
| `flipagent_forwarder_jobs_get` | `GET /v1/forwarder/{provider}/jobs/{jobId}` |
| `flipagent_browser_query` | `POST /v1/browser/query` |

### Buyer comms + post-sale (deal turnover)

| Tool | Backed by |
|---|---|
| `flipagent_messages_list` / `_send` | `GET /v1/messages` / `POST /v1/messages` |
| `flipagent_offers_list` / `_create` / `_eligible_listings` / `_respond` | `/v1/offers/*` (Best Offer in/out) |
| `flipagent_disputes_list` / `_get` / `_respond` | `/v1/disputes/*` (returns + cases + cancellations + inquiries) |
| `flipagent_feedback_list` / `_awaiting` / `_leave` | `/v1/feedback/*` |
| `flipagent_transactions_list` | `GET /v1/transactions` (per-event finance) |

### Listing prerequisites

| Tool | Backed by |
|---|---|
| `flipagent_media_create_upload` / `_get` | `/v1/media/*` (image / video upload) |
| `flipagent_policies_list` / `_list_by_type` | `/v1/policies/*` (return + payment + fulfillment) |
| `flipagent_locations_list` / `_get` / `_upsert` / `_delete` / `_enable` / `_disable` | `/v1/locations/*` |

### Sourcing radar + auctions

| Tool | Backed by |
|---|---|
| `flipagent_watching_list` / `_watch` / `_unwatch` | `/v1/watching/*` |
| `flipagent_saved_searches_list` / `_create` / `_delete` | `/v1/saved-searches/*` |
| `flipagent_trends_categories` | `GET /v1/trends/categories` |
| `flipagent_recommendations_list` | `GET /v1/recommendations` |
| `flipagent_bids_list` / `_place` / `_eligible_listings` | `/v1/bids/*` |

### Seller account

| Tool | Backed by |
|---|---|
| `flipagent_seller_eligibility` / `_privilege` / `_kyc` / `_subscription` / `_payments_program` / `_advertising_eligibility` / `_sales_tax` | `/v1/me/seller/*` |

### Marketing + storefront

| Tool | Backed by |
|---|---|
| `flipagent_promotions_list` / `_create` / `_reports_*` | `/v1/promotions/*` |
| `flipagent_markdowns_list` / `_create` | `/v1/markdowns` |
| `flipagent_ads_campaigns_list/_create`, `_ads_list`, `_groups_list/_create`, `_reports_*` | `/v1/ads/*` (Promoted Listings) |
| `flipagent_store_categories` / `_categories_upsert` | `/v1/store/categories` |

### Listing variations + bulk

| Tool | Backed by |
|---|---|
| `flipagent_listing_groups_get` / `_upsert` / `_delete` | `/v1/listing-groups/*` |
| `flipagent_listings_bulk_get_inventory` / `_get_offers` / `_update_prices` / `_upsert` / `_publish` / `_migrate` | `/v1/listings/bulk/*` |

### Setup-time (webhooks, notifications, key info)

| Tool | Backed by |
|---|---|
| `flipagent_webhooks_register` / `_list` / `_revoke` | `/v1/webhooks/*` |
| `flipagent_notifications_topics` / `_destinations` / `_subscriptions_*` / `_recent` | `/v1/notifications/*` (eBay Platform Notifications) |
| `flipagent_keys_me` | `GET /v1/keys/me` (key tier + usage) |

## Composing reseller workflows

Tools are typed and orthogonal — agents can chain them end-to-end:

> "Search for canon ef 50mm under $100 → pick a candidate → score it →
> estimate landed cost via Planet Express → tell me the net margin."

Translates to:

```
flipagent_items_search({ q: "canon ef 50mm 1.8", filter: "price:[..100]" })
  ↓
flipagent_evaluate({ itemId: results[0].itemId })  (server: detail → sold + active → LLM filter → score)
  ↓
flipagent_ship_quote({ item: results[0], forwarder: { destState: "NY", weightG: 250 } })
```

`flipagent_evaluate` is composite — server-side it fetches detail / sold /
active in parallel, runs an LLM same-product filter, and scores in a
single call. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
`GOOGLE_API_KEY` on the API server to enable the filter; without a key
the composite endpoint falls back to the unfiltered pool.

## Compatibility

Any MCP host over stdio: Claude Desktop, Cursor (`.cursor/mcp.json`),
Cline, Continue.dev, Zed, Windsurf, Claude Code CLI, custom clients.

## License

MIT.
