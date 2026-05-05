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
const { evaluation, sold, active } = await client.evaluate.listing({ itemId: "v1|123456789|0" });

// Estimate landed cost via a forwarder
const quote = await client.ship.quote({ item: items[0], forwarder: { destState: "NY", weightG: 500 } });
```

## Namespaces

| Group | Namespaces |
|---|---|
| Marketplace data | `items`, `categories`, `products`, `media` |
| My side (write) | `listings`, `locations`, `purchases`, `bids`, `sales`, `forwarder` |
| Money + comms | `payouts`, `transactions`, `messages`, `feedback`, `offers`, `disputes` |
| flipagent intelligence | `evaluate`, `ship` |
| Account + ops | `me`, `seller`, `keys`, `billing`, `connect`, `policies`, `recommendations`, `analytics`, `labels`, `notifications`, `webhooks`, `capabilities`, `browser` |
| Agent (preview) | `agent` |
| Escape hatch | `client.http.{get,post,put,delete,patch}(path, body?)` |

Sell-side namespaces (`listings`, `sales`, `payouts`, `transactions`,
`policies`, `seller`, `messages`, `feedback`, `offers`,
`disputes`) need the user to authorize their eBay account first via
`/v1/connect/ebay`. Surfaces deferred from V1 (`expenses`, `trends`,
`promotions`, `markdowns`, `ads`, `store`, `feeds`, `translate`,
`charities`, `featured`, `listing-groups`, `listings/bulk`,
`watching`, `violations`, `marketplaces`) live as
typed wrappers but are not surfaced on the client until promoted.
Reach them through `client.http` if you need them sooner.

## Get a key

Free tier: 1,000 credits one-time (lifetime grant, doesn't refill), no card. Sign up at
[flipagent.dev/signup](https://flipagent.dev/signup).

## Docs

Full reference at [flipagent.dev/docs](https://flipagent.dev/docs).
Source on [GitHub](https://github.com/flipagent/flipagent).

## License

MIT
