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

Restart Claude Desktop. The 30+ tools below appear in any chat.

## Without anything (mock mode)

```json
"env": { "FLIPAGENT_MCP_MOCK": "1" }
```

Tools return canned responses so you can verify the wiring before signing up.

## Tools

All tools call the unified `/v1/*` surface at `api.flipagent.dev`.

### Discovery

| Tool | Backed by |
|---|---|
| `ebay_search` | `GET /v1/buy/browse/item_summary/search` |
| `ebay_item_detail` | `GET /v1/buy/browse/item/{itemId}` |
| `ebay_sold_search` | `GET /v1/buy/marketplace_insights/item_sales/search` |
| `ebay_taxonomy_default_id` | `GET /v1/commerce/taxonomy/get_default_category_tree_id` |
| `ebay_taxonomy_suggest` | `GET /v1/commerce/taxonomy/category_tree/{id}/get_category_suggestions` |
| `ebay_taxonomy_aspects` | `GET /v1/commerce/taxonomy/category_tree/{id}/get_item_aspects_for_category` |
| `flipagent_capabilities` | `GET /v1/capabilities` |

### Decisions / Overnight / Operations (server-side scoring)

| Tool | Backed by |
|---|---|
| `evaluate_listing` | `POST /v1/evaluate` |
| `evaluate_signals` | `POST /v1/evaluate/signals` |
| `discover_deals` | `POST /v1/discover` |
| `research_summary` | `POST /v1/research/summary` |
| `match_pool` | `POST /v1/match` (hosted **or** delegate — see below) |
| `flipagent_match_trace` | `POST /v1/traces/match` (delegate-mode calibration) |
| `draft_listing` | `POST /v1/draft` |
| `reprice_listing` | `POST /v1/reprice` |
| `ship_quote` | `POST /v1/ship/quote` |
| `ship_providers` | `GET /v1/ship/providers` |
| `expenses_record` / `expenses_summary` | `POST /v1/expenses` / `GET /v1/expenses/summary` |

## Hosted vs delegate

`match_pool` is the only tool today that runs an LLM. It supports two
execution modes:

| Mode | Where the LLM runs | Best for |
|---|---|---|
| `hosted` (default) | flipagent backend (we eat the cost) | weak-host agents, scripts, cron, deterministic batched runs |
| `delegate` | the host agent's own LLM (Claude Code, Cursor) | strong-host agents already paying for inference; saves the round-trip |

When the host calls `match_pool` with `options.mode: "delegate"`, the
server does NOT invoke any LLM. It returns a ready-to-run prompt:

```json
{
  "mode": "delegate",
  "system": "You are filtering an eBay search-result POOL...",
  "user": [{ "type": "text", "text": "CANDIDATE ..." }, { "type": "image", "imageUrl": "..." }, ...],
  "itemIds": ["v1|123|0", "v1|456|0", ...],
  "outputSchema": { "type": "array", "items": { ... } },
  "outputHint": "Return ONLY a JSON array...",
  "traceId": "<uuid>"
}
```

The host LLM reasons over `system` + `user`, returns
`[{i, bucket, reason}]` per pool item, and the host materialises the
two-bucket `MatchResponse` locally. Optionally, it then calls
`flipagent_match_trace` with the verdicts so flipagent's calibration
data stays current.

## Telemetry

`flipagent_match_trace` is the only telemetry path. It is:

- **Opt-out**, not opt-in. Runs by default.
- **Anonymous**: we store the trace id we issued, the verdicts, and a
  short SHA-256 prefix of your API key for rate-limit accounting. We
  do **not** link traces to your account.
- **Bounded**: only triggered after a delegate-mode `match_pool` call.
  Hosted-mode and read-only tools never produce traces.

Disable with an env var (matches OSS conventions —
`HOMEBREW_NO_ANALYTICS`, `NEXT_TELEMETRY_DISABLED`,
`ASTRO_TELEMETRY_DISABLED`):

```json
"env": {
  "FLIPAGENT_API_KEY": "fa_free_xxx",
  "FLIPAGENT_TELEMETRY": "0"
}
```

Accepted off-values: `0`, `off`, `false`, `no`, `disabled`. When
disabled, the `flipagent_match_trace` tool returns
`{ skipped: "telemetry_disabled" }` without making any network call.

What we use traces for: keeping the scoring math calibrated as host
LLMs drift, regression detection on prompt updates, public-facing
quality reports. We don't redistribute them and we don't sell them.

### Sell-side (eBay OAuth required)

Run `/v1/connect/ebay` once to bind your eBay seller account, then:

| Tool | Backed by |
|---|---|
| `flipagent_connect_status` | `GET /v1/connect/ebay/status` |
| `ebay_create_inventory_item` | `PUT /v1/sell/inventory/inventory_item/{sku}` |
| `ebay_create_offer` | `POST /v1/sell/inventory/offer` |
| `ebay_publish_offer` | `POST /v1/sell/inventory/offer/{offerId}/publish` |
| `ebay_list_orders` | `GET /v1/sell/fulfillment/order` |
| `ebay_mark_shipped` | `POST /v1/sell/fulfillment/order/{orderId}/shipping_fulfillment` |
| `ebay_list_payouts` | `GET /v1/sell/finances/payout` |

### Buy ordering + bridge (Chrome extension required)

The `/v1/buy/order/*` surface runs in two transports — REST passthrough (with eBay's Buy Order API approval, `EBAY_ORDER_API_APPROVED=1`) or bridge (the Chrome extension auto-navigates the listing in your real Chrome session; you click Buy It Now + Confirm-and-pay yourself, the extension records the result). Same response shape either way.

| Tool | Backed by |
|---|---|
| `ebay_buy_item` | `POST /v1/buy/order/checkout_session/initiate` + `place_order` (one-shot) |
| `ebay_order_status` | `GET /v1/buy/order/purchase_order/{id}` |
| `ebay_order_cancel` | `POST /v1/buy/order/purchase_order/{id}/cancel` (bridge transport only) |
| `planet_express_packages` | `POST /v1/forwarder/planetexpress/refresh` |
| `browser_query` | `POST /v1/browser/query` |

## Composing reseller workflows

Tools are typed and orthogonal — agents can chain them end-to-end:

> "Find canon ef 50mm under $100 → score the deals → estimate landed
> cost via Planet Express → pick the best one and tell me the net margin."

Translates to:

```
ebay_search(q="canon ef 50mm 1.8")
  ↓
ebay_sold_search(q="canon ef 50mm 1.8")
  ↓
discover_deals({ results, opts: { comps, minNetCents: 2000 } })
  ↓
ship_quote({ item: deals[0].item, forwarder: { destState: "NY", weightG: 250 } })
```

### Delegate-mode workflow (free LLM via the host)

```
ebay_sold_search(q="...")
  ↓
match_pool({ candidate, pool, options: { mode: "delegate" } })
  ↓                                                 (LLM call: HOST agent reasons over system+user)
flipagent_match_trace({ traceId, candidateId, decisions })   ← optional, opt-out via FLIPAGENT_TELEMETRY=0
  ↓
evaluate_listing({ item: candidate, opts: { comps: filtered } })
```

## Compatibility

Any MCP host over stdio: Claude Desktop, Cursor (`.cursor/mcp.json`),
Cline, Continue.dev, Zed, Windsurf, Claude Code CLI, custom clients.

## License

MIT.
