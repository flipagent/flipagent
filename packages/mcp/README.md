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

Restart Claude Desktop. The 18 tools below appear in any chat.

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
| `ebay_search` | `GET /v1/listings/search` |
| `ebay_item_detail` | `GET /v1/listings/{itemId}` |
| `ebay_sold_search` | `GET /v1/sold/search` |
| `ebay_taxonomy_default_id` | `GET /v1/markets/taxonomy/get_default_category_tree_id` |
| `ebay_taxonomy_suggest` | `GET /v1/markets/taxonomy/category_tree/{id}/get_category_suggestions` |
| `ebay_taxonomy_aspects` | `GET /v1/markets/taxonomy/category_tree/{id}/get_item_aspects_for_category` |

### Decisions / Overnight / Operations (server-side scoring)

| Tool | Backed by |
|---|---|
| `evaluate_listing` | `POST /v1/evaluate` |
| `evaluate_signals` | `POST /v1/evaluate/signals` |
| `discover_deals` | `POST /v1/discover` |
| `ship_quote` | `POST /v1/ship/quote` |
| `ship_providers` | `GET /v1/ship/providers` |

### Sell-side (eBay OAuth required)

Run `/v1/connect/ebay` once to bind your eBay seller account, then:

| Tool | Backed by |
|---|---|
| `flipagent_connect_status` | `GET /v1/connect/ebay/status` |
| `ebay_create_inventory_item` | `PUT /v1/inventory/inventory_item/{sku}` |
| `ebay_create_offer` | `POST /v1/inventory/offer` |
| `ebay_publish_offer` | `POST /v1/inventory/offer/{offerId}/publish` |
| `ebay_list_orders` | `GET /v1/fulfillment/order` |
| `ebay_mark_shipped` | `POST /v1/fulfillment/order/{orderId}/shipping_fulfillment` |
| `ebay_list_payouts` | `GET /v1/finance/payout` |

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

## Compatibility

Any MCP host over stdio: Claude Desktop, Cursor (`.cursor/mcp.json`),
Cline, Continue.dev, Zed, Windsurf, Claude Code CLI, custom clients.

## License

MIT.
