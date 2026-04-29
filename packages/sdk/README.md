# @flipagent/sdk

Typed TypeScript client for [`api.flipagent.dev`](https://flipagent.dev) — ONE
unified surface for the full reseller cycle (discovery → evaluation → buying →
listing → fulfillment → finance) across marketplaces.

```bash
npm install @flipagent/sdk
```

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Discovery — search active listings (eBay-shape response)
const results = await client.listings.search({ q: "canon ef 50mm 1.8", limit: 50 });

// Sold comps — last 90 days
const sold = await client.sold.search({ q: "canon ef 50mm 1.8", limit: 50 });

// Decisions — score one listing
const verdict = await client.evaluate.listing({ item, opts: { comps } });

// Overnight — rank deals across a search
const { deals } = await client.discover.deals({ results, opts: { minNetCents: 2000 } });

// Operations — landed cost via forwarder
const quote = await client.ship.quote({ item, forwarder: { destState: "NY", weightG: 500 } });
```

## Namespaces

| Group | Namespaces |
|---|---|
| Marketplace passthrough | `listings`, `sold`, `orders`, `inventory`, `fulfillment`, `finance`, `markets` |
| flipagent intelligence | `market`, `match`, `evaluate`, `discover`, `ship`, `draft`, `reprice`, `expenses` |
| Ops | `webhooks`, `capabilities` |
| Escape hatch | `client.http.{get,post,put,delete,patch}(path, body?)` |

Sell-side namespaces (`inventory`, `fulfillment`, `finance`, `markets`) need
the user to authorize their eBay account first via `/v1/connect/ebay`.

## Get a key

Free tier: 100 calls/month, no card. Sign up at
[flipagent.dev/signup](https://flipagent.dev/signup).

## Docs

Full reference at [flipagent.dev/docs](https://flipagent.dev/docs).
Source on [GitHub](https://github.com/flipagent/flipagent).

## License

MIT
