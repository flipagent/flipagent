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

// Search active listings (eBay-shape response)
const { itemSummaries } = await client.listings.search({ q: "canon ef 50mm 1.8", limit: 50 });

// Search sold listings (last 90 days)
const { itemSales } = await client.sold.search({ q: "canon ef 50mm 1.8", limit: 50 });

// Score one listing — composite (server fetches detail + sold + active)
const evaluation = await client.evaluate.listing({ itemId: "v1|123456789|0" });

// Rank deals for a query — composite (server runs the full pipeline)
const { deals } = await client.discover.deals({ q: "canon ef 50mm 1.8", opts: { minNetCents: 2000 } });

// Estimate landed cost via a forwarder
const quote = await client.ship.quote({ item: itemSummaries[0], forwarder: { destState: "NY", weightG: 500 } });
```

## Namespaces

| Group | Namespaces |
|---|---|
| Marketplace passthrough | `listings`, `sold`, `buy.order`, `inventory`, `fulfillment`, `finance`, `markets`, `forwarder` |
| flipagent intelligence | `evaluate`, `discover`, `ship`, `expenses` |
| Ops | `webhooks`, `capabilities` |
| Escape hatch | `client.http.{get,post,put,delete,patch}(path, body?)` |

Sell-side namespaces (`inventory`, `fulfillment`, `finance`, `markets`) need
the user to authorize their eBay account first via `/v1/connect/ebay`.

## Get a key

Free tier: 500 credits one-time (lifetime grant, doesn't refill), no card. Sign up at
[flipagent.dev/signup](https://flipagent.dev/signup).

## Docs

Full reference at [flipagent.dev/docs](https://flipagent.dev/docs).
Source on [GitHub](https://github.com/flipagent/flipagent).

## License

MIT
