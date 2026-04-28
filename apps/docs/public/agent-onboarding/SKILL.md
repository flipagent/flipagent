---
name: flipagent-onboarding
description: Set up flipagent — ONE API for online reselling — for the user. Handles signup, API key retrieval, MCP / SDK / HTTP configuration, and verification with a first call. Fetch this when the user asks to "use flipagent", "set up flipagent", "find me deals on eBay using flipagent", or similar.
---

# flipagent agent onboarding

flipagent is one API for the online reselling cycle: search listings,
look up sold-comps, score deals, quote forwarder cost, place orders,
list inventory, ship, track payouts. Today it covers eBay; future
adapters will cover Amazon, Mercari, Poshmark via the same paths.

You are an AI agent helping a user wire flipagent into their workflow.
Follow the steps in order. Don't skip Step 4 (verification) — silent
failures here become silent failures later.

## Step 1 — Identify the user's runtime

Pick one based on what you know about the user. Default to MCP if the
user is talking to you through Claude Desktop / Cursor / Cline / Zed /
Windsurf / Continue. Default to SDK if the user is building Node /
TypeScript code. Default to HTTP otherwise.

| Runtime | Path |
|---|---|
| MCP-capable AI client (Claude Desktop, Cursor, …) | Step 3a |
| Node / TypeScript app | Step 3b |
| Python / Go / Rust / other | Step 3c |

If unsure, ask the user.

## Step 2 — Get an API key

First check `FLIPAGENT_API_KEY` in the environment. If present and
matching `^fa_(free|hobby|pro|business)_[A-Za-z0-9]{16,}$`, skip ahead
to verification (`curl -H "Authorization: Bearer $FLIPAGENT_API_KEY"
https://api.flipagent.dev/v1/keys/me` should return 200).

If absent or invalid:

1. Direct the user to `https://flipagent.dev/signup` (open the URL if
   you have a browser tool; otherwise instruct the user to open it).
   Tell them: "Free tier is 100 calls/month, no card."
2. Ask the user to paste back the key (`fa_free_*`).
3. Verify:
   ```
   curl -s -H "Authorization: Bearer <KEY>" https://api.flipagent.dev/v1/keys/me
   ```
   Expect HTTP 200 with `{"tier":"free", ...}`. If 401, the key is
   wrong — ask again. If network error, retry once.
4. Save the key:
   - For MCP / CLI flows: write to env (handled automatically by the
     `flipagent-cli init --mcp` command in Step 3a).
   - For Node projects: append `FLIPAGENT_API_KEY=<key>` to `.env` and
     ensure `.env` is in `.gitignore`.
   - For shell scripts: `export FLIPAGENT_API_KEY=<key>`.

## Step 3 — Configure for the user's runtime

### 3a. MCP-capable AI client

Run the one-command installer. It detects every supported client
(Claude Desktop, Cursor, Cline, Zed, Continue, Windsurf) and writes the
correct config file:

```
npx -y flipagent-cli init --mcp
```

Pass `--keys` to skip the interactive key prompt and use the
`FLIPAGENT_API_KEY` env var:

```
FLIPAGENT_API_KEY=fa_free_xxx npx -y flipagent-cli init --mcp --keys
```

After the CLI exits, tell the user to **restart their AI client**.
Tools won't appear until restart.

Manual fallback (Claude Desktop):

- File: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Patch the `mcpServers` object:
  ```json
  {
    "mcpServers": {
      "flipagent": {
        "command": "npx",
        "args": ["-y", "flipagent-mcp"],
        "env": { "FLIPAGENT_API_KEY": "fa_free_xxx" }
      }
    }
  }
  ```

Cursor uses `.cursor/mcp.json` (in workspace). Cline uses
`~/.cline/mcp.json`. Zed and Windsurf use their settings panel.

### 3b. Node / TypeScript app

```
npm install @flipagent/sdk
```

In code:

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({
  apiKey: process.env.FLIPAGENT_API_KEY!,
});
```

Available namespaces (every endpoint at `api.flipagent.dev/v1/*`):

| Namespace | Use for |
|---|---|
| `client.listings.*` | search + detail (eBay-shape responses) |
| `client.sold.*` | comparable-sales lookup (last 90 days) |
| `client.evaluate.*` | score one listing → DealVerdict (Decisions pillar) |
| `client.discover.*` | rank deals across a search (Overnight pillar) |
| `client.ship.*` | forwarder quote + provider catalog (Operations pillar) |
| `client.orders.*` | buy flow (Limited Release; needs `/v1/connect/ebay`) |
| `client.inventory.*` | seller-side write (needs `/v1/connect/ebay`) |
| `client.fulfillment.*` | shipping + tracking |
| `client.finance.*` | payouts + transactions |
| `client.markets.*` | taxonomy + selling policies |
| `client.http.*` | escape hatch for any /v1/* path not yet typed |

### 3c. Other languages (Python, Go, Rust, ...)

There's no language-specific SDK yet. Use HTTP directly:

```
curl "https://api.flipagent.dev/v1/listings/search?q=canon+50mm&limit=10" \
  -H "Authorization: Bearer $FLIPAGENT_API_KEY"
```

The OpenAPI spec is at `https://api.flipagent.dev/openapi.json`. Feed it
to your language's codegen (e.g. `openapi-python-client`,
`openapi-generator`) for typed bindings.

## Step 4 — Verify with one harmless call

Run exactly one call to confirm the wiring is alive. Pick by runtime:

**MCP** (3a): Tell the user to ask their AI client "search eBay for
canon ef 50mm using flipagent". The `ebay_search` tool should fire and
return results. If the tool doesn't appear, the client wasn't restarted.

**SDK** (3b):
```ts
const r = await client.listings.search({ q: "canon ef 50mm", limit: 1 });
console.log(r.itemSummaries?.length ?? 0, "result(s)");
```
Expect `1 result(s)`.

**HTTP** (3c):
```
curl -s "https://api.flipagent.dev/v1/listings/search?q=canon+50mm&limit=1" \
  -H "Authorization: Bearer $FLIPAGENT_API_KEY" | jq .total
```
Expect a non-zero number.

If verification fails:

| HTTP status | Meaning | Fix |
|---|---|---|
| 401 | Key invalid or revoked | Re-do Step 2 |
| 429 | Tier quota exhausted | Wait until UTC monthly reset, or upgrade at `/v1/billing/checkout` |
| 502 | Upstream eBay transient | Retry once. If repeats, log and surface to user |
| 503 | Service-side env not configured (unusual on hosted) | Check `https://api.flipagent.dev/healthz` |

## Step 5 — Tell the user what's possible

After verified setup, summarize the agent's new capabilities:

- **Discover deals**: search + sold-comp + ranked-deals all in one
  reseller workflow. End-to-end with `client.listings.search` →
  `client.sold.search` → `client.discover.deals({ results, opts: {
  comps } })`.
- **Decide on a single listing**: `client.evaluate.listing({ item, opts:
  { comps } })` → buy / watch / skip verdict + signals fired.
- **Estimate landed cost**: `client.ship.quote({ item, forwarder })` →
  total delivered cost via Planet Express (more forwarders coming).
- **Sell-side** (after `/v1/connect/ebay`): create inventory items,
  publish offers, list orders, mark shipped, fetch payouts.

The user will likely ask you to do real work (e.g. "find me canon
lenses under $100 with positive margin"). The full chain looks like:

```
listings.search(q="canon lens", filter="price:[..100]")
  ↓
sold.search(q="canon lens")
  ↓
discover.deals({ results, opts: { comps, minNetCents: 1500 } })
  ↓
ship.quote({ item: deals[0].item, forwarder: { destState, weightG } })
  ↓
present top 3 to user with rationale
```

## Reference

- Docs: https://flipagent.dev/docs
- API reference: https://flipagent.dev/docs/api
- OpenAPI spec: https://api.flipagent.dev/openapi.json
- GitHub: https://github.com/flipagent/flipagent
- This skill: https://flipagent.dev/agent-onboarding/SKILL.md

## Compliance note

eBay's User Agreement (effective 2026-02-20) restricts unattended AI
agent access. flipagent's hosted operations are within scope; the
caller bears responsibility for their own use. If the user asks you to
auto-purchase items without human review, decline and explain the ToS
issue.
