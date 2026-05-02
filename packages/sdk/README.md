# @flipagent/sdk

Typed TypeScript client for [`api.flipagent.dev`](https://flipagent.dev) — ONE
unified surface for the full reseller cycle (search → evaluation → buying →
listing → fulfillment → finance) across marketplaces.

```bash
npm install @flipagent/sdk
```

```ts
import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: process.env.FLIPAGENT_API_KEY! });

// Search active listings
const { items } = await client.items.search({ q: "canon ef 50mm 1.8", limit: 50 });

// Search sold listings (last 90 days)
const { items: sold } = await client.items.search({ q: "canon ef 50mm 1.8", status: "sold", limit: 50 });

// Score one listing — composite (server fetches detail + sold + active)
const evaluation = await client.evaluate.listing({ itemId: "v1|123456789|0" });

// Estimate landed cost via a forwarder
const quote = await client.ship.quote({ item: items[0], forwarder: { destState: "NY", weightG: 500 } });
```

## Namespaces

| Group | Namespaces |
|---|---|
| Marketplace data | `items`, `categories`, `products` |
| My side (write) | `listings`, `purchases`, `sales` |
| Money + disputes | `payouts`, `transactions`, `disputes`, `policies` |
| flipagent intelligence | `evaluate`, `ship`, `expenses` |
| Logistics + ops | `forwarder`, `webhooks`, `capabilities` |
| Escape hatch | `client.http.{get,post,put,delete,patch}(path, body?)` |

Sell-side namespaces (`listings`, `sales`, `payouts`, `transactions`,
`policies`) need the user to authorize their eBay account first via
`/v1/connect/ebay`.

## Get a key

Free tier: 500 credits one-time (lifetime grant, doesn't refill), no card. Sign up at
[flipagent.dev/signup](https://flipagent.dev/signup).

## Docs

Full reference at [flipagent.dev/docs](https://flipagent.dev/docs).
Source on [GitHub](https://github.com/flipagent/flipagent).

## License

MIT
