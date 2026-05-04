# flipagent-mcp

MCP server that gives Claude Code (and any MCP-compatible host over
stdio) a one-stop reseller API covering the full source → evaluate →
buy → list → fulfill → finance loop.

```bash
npx -y flipagent-cli init --mcp
```

The CLI writes the host config in one go. Manual setup is in
[§ Config](#config).

---

## Your first 60 seconds

```bash
# 1. Install + register with your MCP host.
npx -y flipagent-cli init --mcp --keys

# 2. Get an api key (or sign in to grab an existing one).
open https://flipagent.dev/dashboard/

# 3. Restart the host. The default toolset appears in any chat.
```

Ask the agent something concrete:

> "Find me three under-$100 Canon EF 50mm lenses worth flipping. Show your math."

The agent chains `flipagent_get_capabilities` → `flipagent_search_items`
→ `flipagent_evaluate_item` (3×) → returns verdicts with bid ceilings,
expected net, and 3–5 sold comparables per item as evidence. No eBay
account needed for that loop.

To go further (buy / list / ship / payout reads), connect an eBay seller
account once via `https://api.flipagent.dev/v1/connect/ebay` (any
sell-side tool's error response will surface that exact URL when OAuth
is missing — relay it to your user).

---

## Toolsets — controlling what shows up

Tools group by domain so the host loads only what's needed. Default =
`core`. Set `FLIPAGENT_MCP_TOOLSETS` (comma-separated, or `*` for
everything) to add more.

| Toolset | Default? | What's in it |
|---|:-:|---|
| **`core`** | ✅ | Sourcing (`search`, `get`, `evaluate`), buy (`create_purchase`, `get_purchase`, `cancel_purchase`, bids), listing essentials (`create`, `update`, `relist`, policies, locations, media), sale fulfillment (`list_sales`, `ship_sale`), finance (`payouts`, `transactions`), recommendations, programs. |
| **`comms`** | ⬜ | Buyer messages, Best Offers in/out, disputes/returns, feedback. |
| **`forwarder`** | ⬜ | Package-forwarder ops via the flipagent extension (Planet Express today). |
| **`notifications`** | ⬜ | flipagent webhooks + eBay Platform Notifications. |
| **`seller_account`** | ⬜ | Seller diagnostics (privilege, KYC, subscription, payments program, advertising eligibility, sales tax). |
| **`admin`** | ⬜ | Ship providers, location detail/delete + state toggles, browser-DOM escape hatch (`flipagent_query_browser`). |

```jsonc
{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": {
        "FLIPAGENT_API_KEY": "fa_...",
        "FLIPAGENT_MCP_TOOLSETS": "core,comms"
      }
    }
  }
}
```

---

## Tool naming + error-handling conventions

Every tool is `flipagent_<verb>_<resource>` (snake_case, action-leading).
The `flipagent_` prefix avoids collisions when other MCP servers are
loaded alongside. Marketplace stays a parameter, never part of the tool
name — Amazon / Mercari adapters reuse the same names.

Errors that the caller can fix carry a `next_action: { kind, url,
instructions }` block. The MCP renders that into `isError: true`
content verbatim — relay the text to the end user and they'll know
exactly where to go.

---

## Mock mode

Set `FLIPAGENT_MCP_MOCK=1` to return canned responses without calling
the real api. Useful when verifying the host config first.

```jsonc
{ "env": { "FLIPAGENT_MCP_MOCK": "1" } }
```

---

## Self-host / staging

Point the MCP server at a non-production api with `FLIPAGENT_BASE_URL`.
Default is `https://api.flipagent.dev`.

```jsonc
{
  "env": {
    "FLIPAGENT_API_KEY": "fa_...",
    "FLIPAGENT_BASE_URL": "http://localhost:4000"
  }
}
```

---

## Config

Add to your MCP host's config:

```json
{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": { "FLIPAGENT_API_KEY": "fa_..." }
    }
  }
}
```

Restart the host after editing.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every tool 401s | `FLIPAGENT_API_KEY` not set or revoked. | Set in MCP host env; restart host. |
| Sell-side tools 401 with `ebay_account_not_connected` | API key has no eBay OAuth. | The error response carries `next_action.url` — open it in a browser, authorize, retry. |
| `flipagent_create_purchase` returns 412 `transport_unavailable` | No REST approval **and** extension not paired. | Pair the extension (recommended) per `next_action.url`, or have the api operator set `EBAY_ORDER_APPROVED=1`. |
| Forwarder / `query_browser` calls 504 | Extension not paired, or user not signed into the target site in the paired browser profile. | Check `flipagent_get_capabilities().client.extensionPaired`. If true, ensure user is signed into planetexpress.com / ebay.com in that profile. |

Stuck? File an issue at https://github.com/flipagent/flipagent.

---

## License

MIT.
