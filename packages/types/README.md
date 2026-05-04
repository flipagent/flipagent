# @flipagent/types

[TypeBox](https://github.com/sinclairzx81/typebox) schemas for the
[flipagent](https://flipagent.dev) hosted API. Two subpaths:

- `@flipagent/types` — schemas for flipagent's own `/v1/*` surface,
  one file per resource (`items`, `evaluate`, `ship`, `purchases`,
  `bids`, `listings`, `locations`, `policies`, `media`, `sales`,
  `labels`, `payouts`, `money`, `messages`, `feedback`, `offers`,
  `disputes`, `recommendations`, `forwarder`, `notifications`,
  `webhooks`, `bridge`, `browser`, `categories`, `products`, `seller`,
  `me-account`, `me-ebay`, `agent`, `legal`, `flipagent` errors +
  tiers, plus `compute-jobs` / `bridge-jobs` envelopes).
- `@flipagent/types/ebay` — schemas mirroring eBay REST shapes —
  `/buy` (Browse + Marketplace Insights) and `/sell` (Inventory,
  Fulfillment, Finance, Account).

```bash
npm install @flipagent/types
```

```ts
import { Value } from "@sinclair/typebox/value";
import { EvaluateRequest } from "@flipagent/types";
import type { ItemSummary, BrowseSearchResponse } from "@flipagent/types/ebay";

// Validate a request body before posting
const errors = [...Value.Errors(EvaluateRequest, body)];
if (errors.length) throw new Error("invalid evaluate body");

// Use the eBay shapes as your wire types
const json: BrowseSearchResponse = await fetch(...).then(r => r.json());
```

Most users will reach for [`@flipagent/sdk`](https://www.npmjs.com/package/@flipagent/sdk)
instead, which wraps these schemas in a typed client. Use this package
directly when you're building a non-TypeScript-SDK surface (a Hono server
that validates inbound requests, a code-generator, etc.).

## License

MIT
