<h3 align="center">
  <a name="readme-top"></a>
  <img
    src="https://raw.githubusercontent.com/flipagent/flipagent/main/apps/docs/public/logo.png"
    height="110"
    alt="flipagent"
  >
</h3>

<div align="center">
  <a href="https://github.com/flipagent/flipagent">
    <img src="https://img.shields.io/github/stars/flipagent/flipagent.svg?style=social&label=Star&maxAge=2592000" alt="GitHub stars">
  </a>
  <a href="#license">
    <img src="https://img.shields.io/badge/license-MIT%20%2F%20FSL-blue.svg" alt="License">
  </a>
  <a href="https://flipagent.dev">
    <img src="https://img.shields.io/badge/visit-flipagent.dev-orange" alt="Visit flipagent.dev">
  </a>
</div>

<div>
  <p align="center">
    <a href="https://discord.gg/PUyURdjMtv">
      <img src="https://img.shields.io/badge/Join%20our%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord">
    </a>
    <a href="https://x.com/flipagent_dev">
      <img src="https://img.shields.io/badge/Follow%20on%20X-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow on X">
    </a>
  </p>
</div>

---

# **flipagent**

**Let your agent run the eBay reselling business autonomously.** One API for the full reseller cycle. Open source, hosted at [flipagent.dev](https://flipagent.dev).

---

## Why flipagent?

- **End-to-end.** Source, buy, list, sell. The integrated forwarder receives and ships for you, so you never touch a box.
- **Agent-native.** Built for autonomous loops where you only make the decisions.
- **Open source.** SDK, MCP, CLI all MIT. Self-host the backend if you want to.

---

## Quick Start

> **Want to try it before installing anything?** Run Sourcing and Evaluate live in the [playground](https://flipagent.dev/playground) right now.

1. Sign up at [flipagent.dev](https://flipagent.dev/signup) for an API key (500 credits, no card).
2. Install the MCP server in your AI client (Claude Code and others):
   ```bash
   npx -y flipagent-cli init --mcp
   ```
3. Restart your client. Then ask your agent.

### Sourcing

> "Find me underpriced vintage camera lots ending in the next 24 hours."

The agent looks up the category, then calls `flipagent_items_search { "categoryId": "...", "sort": "endTimeSoonest" }` and surfaces deals worth a closer look.

<details>
<summary><b>SDK / cURL</b></summary>

**SDK**
```ts
const { items } = await client.items.search({ categoryId: "...", sort: "endTimeSoonest" });
```

**cURL**
```bash
curl -X GET 'https://api.flipagent.dev/v1/items/search?categoryId=...&sort=endTimeSoonest' \
  -H 'X-API-Key: fa_YOUR_API_KEY'
```
</details>

### Evaluate

> "Evaluate this eBay listing for me: https://www.ebay.com/itm/123456789. Is it a good flip?"

The agent calls `flipagent_evaluate { "itemId": "https://www.ebay.com/itm/123456789" }` and gets back a rating plus expected net profit.

<details>
<summary><b>SDK / cURL</b></summary>

**SDK**
```ts
const { evaluation } = await client.evaluate.listing({ itemId: "https://www.ebay.com/itm/123456789" });
```

**cURL**
```bash
curl -X POST 'https://api.flipagent.dev/v1/evaluate' \
  -H 'X-API-Key: fa_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{ "itemId": "https://www.ebay.com/itm/123456789" }'
```
</details>

### Buy

> "Buy this one for me: https://www.ebay.com/itm/123456789."

The agent calls `flipagent_purchases_create { "items": [...], "humanReviewedAt": "..." }`. eBay's policy makes checkout human-only, so the order pauses for your confirmation before it's placed.

<details>
<summary><b>SDK / cURL</b></summary>

**SDK**
```ts
const order = await client.purchases.create({
  items: [{ itemId: "https://www.ebay.com/itm/123456789", quantity: 1 }],
  humanReviewedAt: new Date().toISOString(),
});
```

**cURL**
```bash
curl -X POST 'https://api.flipagent.dev/v1/purchases' \
  -H 'X-API-Key: fa_YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "items": [{ "itemId": "https://www.ebay.com/itm/123456789", "quantity": 1 }],
    "humanReviewedAt": "2026-05-02T12:00:00Z"
  }'
```
</details>

---

## Other Ways to Connect

### MCP (manual config)

If you'd rather paste the config yourself instead of running the CLI:

```json
{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": {
        "FLIPAGENT_API_KEY": "fa_YOUR_API_KEY"
      }
    }
  }
}
```

### Agent Onboarding

Are you an AI agent? Fetch this skill to sign up your user, get an API key, and start building.

```bash
curl -s https://flipagent.dev/agent-onboarding/SKILL.md
```

### SDK

For TypeScript or Node.js apps.

```bash
npm install @flipagent/sdk
```

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

await client.items.search({ q: "canon ef 50mm 1.8" });
await client.evaluate.listing({ itemId: "https://www.ebay.com/itm/123456789" });
await client.purchases.create({ items, humanReviewedAt: new Date().toISOString() });
```

Sell-side endpoints (listings, sales, payouts) need you to authorize your eBay account first via `/v1/connect/ebay`.

---

## More Endpoints

### Listings

One call publishes a listing live on eBay.

```ts
await client.listings.create({ sku, title, price, condition, categoryId, images, policies, merchantLocationKey });
await client.listings.update(sku, { price, quantity });
await client.listings.end(sku);
await client.listings.relist(sku);
```

### Forwarder

Pulls inbound package status from your forwarder (Planet Express today).

```ts
await client.forwarder.planetExpress.packages();
```

Sales, payouts, transactions, expenses, categories, products, and ship quotes are all available too. See the [API reference](https://flipagent.dev/docs/api).

---

## Self-host

The backend is source-available under [FSL-1.1-ALv2](packages/api/LICENSE).

```bash
git clone https://github.com/flipagent/flipagent && cd flipagent
docker compose up
docker compose exec api node packages/api/dist/scripts/issue-key.js you@example.com
```

Migrations run on boot. Scraper, Stripe, and OAuth credentials are optional; drop them in `packages/api/.env` (copy from `.env.example`) when you want them. See [`packages/api/README.md`](packages/api/README.md) for production setup.

---

## Resources

- [Documentation](https://flipagent.dev/docs)
- [API Reference](https://flipagent.dev/docs/api)
- [Playground](https://flipagent.dev/playground)
- [Changelog](https://flipagent.dev/changelog)

---

## Disclaimer

flipagent is an experimental research project. **Not affiliated with, endorsed by, or sponsored by eBay Inc.** The hosted endpoint at `api.flipagent.dev` may be unavailable, rate-limited, or removed without notice.

eBay's [User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259) (effective 2026-02-20) and [API License Agreement](https://developer.ebay.com/join/api-license-agreement) restrict automated activity, AI training on eBay data, and transfer of eBay data to third parties. If you use this code or the hosted API, you are responsible for whether your use case is permitted, for securing your credentials, and for any account action or legal consequence. The authors accept no liability.

---

## License

| package | license |
|---|---|
| `types`, `ebay-scraper`, `sdk`, `mcp`, `cli` | MIT |
| `extension` | MIT |
| `api` | FSL-1.1-ALv2 (source-available, converts to Apache 2.0 in 2 years) |
| `apps/docs` | All Rights Reserved |

See each `LICENSE` file for full text.

<p align="right" style="font-size: 14px; color: #555; margin-top: 20px;">
  <a href="#readme-top" style="text-decoration: none; font-weight: bold;">
    ↑ Back to Top ↑
  </a>
</p>
