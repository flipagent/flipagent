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

### Marketplace data

| Tool | Backed by |
|---|---|
| `ebay_search` | `GET /v1/items/search` |
| `ebay_item_detail` | `GET /v1/items/{itemId}` |
| `ebay_sold_search` | `GET /v1/items/search?status=sold` |
| `ebay_taxonomy_default_id` | `GET /v1/categories?marketplace={id}` |
| `ebay_taxonomy_suggest` | `GET /v1/categories/suggest?q={query}` |
| `ebay_taxonomy_aspects` | `GET /v1/categories/{id}/aspects` |
| `flipagent_capabilities` | `GET /v1/capabilities` |

### Decisions / Operations (server-side scoring)

| Tool | Backed by |
|---|---|
| `evaluate_listing` | `POST /v1/evaluate` — composite (detail → search sold + active → LLM same-product filter → score) |
| `ship_quote` | `POST /v1/ship/quote` |
| `ship_providers` | `GET /v1/ship/providers` |
| `expenses_record` / `expenses_summary` | `POST /v1/expenses` / `GET /v1/expenses/summary` |

Same-product filtering uses an LLM internally — set `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GOOGLE_API_KEY` on the API server to enable. When
no provider is configured, the composite endpoints fall back to the raw
sold + active pools (looser, evaluations still run).

### Sell-side (eBay OAuth required)

Run `/v1/connect/ebay` once to bind your eBay seller account, then:

| Tool | Backed by |
|---|---|
| `flipagent_connect_status` | `GET /v1/connect/ebay/status` |
| `ebay_create_inventory_item` | `PUT /v1/listings/{sku}` |
| `ebay_create_offer` | `POST /v1/listings` |
| `ebay_publish_offer` | `POST /v1/listings/{sku}/relist` |
| `ebay_list_orders` | `GET /v1/sales` |
| `ebay_mark_shipped` | `POST /v1/sales/{id}/ship` |
| `ebay_list_payouts` | `GET /v1/payouts` |

### Buy ordering + bridge surfaces

The `/v1/purchases` surface runs in two transports — REST passthrough (with eBay's Buy Order API approval, `EBAY_ORDER_API_APPROVED=1`) or bridge (the Chrome extension navigates the listing in your real Chrome session; you click Buy It Now + Confirm-and-pay yourself, the extension records the result). Same response shape either way; pick per call with `?transport=rest|bridge` or let the capability matrix decide. Forwarder ops (`/v1/forwarder/*`) and browser DOM queries (`/v1/browser/*`) are bridge-only — they read from the user's logged-in sessions through the extension.

| Tool | Backed by |
|---|---|
| `ebay_buy_item` | `POST /v1/purchases` (one-shot) |
| `ebay_order_status` | `GET /v1/purchases/{id}` |
| `ebay_order_cancel` | `POST /v1/purchases/{id}/cancel` (bridge transport only) |
| `planet_express_packages` | `POST /v1/forwarder/planetexpress/refresh` |
| `browser_query` | `POST /v1/browser/query` |

## Composing reseller workflows

Tools are typed and orthogonal — agents can chain them end-to-end:

> "Search for canon ef 50mm under $100 → pick a candidate → score it →
> estimate landed cost via Planet Express → tell me the net margin."

Translates to:

```
ebay_search({ q: "canon ef 50mm 1.8", filter: "price:[..100]" })
  ↓
evaluate_listing({ itemId: results[0].itemId })  (server: detail → sold + active → LLM filter → score)
  ↓
ship_quote({ item: results[0], forwarder: { destState: "NY", weightG: 250 } })
```

`evaluate_listing` is composite — server-side it fetches detail / sold /
active in parallel, runs an LLM same-product filter, and scores in a
single call. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
`GOOGLE_API_KEY` on the API server to enable the filter; without a key
the composite endpoint falls back to the unfiltered pool.

## Compatibility

Any MCP host over stdio: Claude Desktop, Cursor (`.cursor/mcp.json`),
Cline, Continue.dev, Zed, Windsurf, Claude Code CLI, custom clients.

## License

MIT.
