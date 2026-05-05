---
"@flipagent/types": minor
"@flipagent/sdk": minor
"flipagent-mcp": minor
---

**Marketplace literal moves to provider+region combined (`ebay_us`).**

The `Marketplace` literal in `@flipagent/types` narrows from
`"ebay" | "amazon" | "mercari" | "poshmark"` to `"ebay_us"`. The new
convention is snake_case `provider_region` — `ebay_us`, `ebay_gb`,
`stockx`, `amazon_us`, `mercari_jp`, etc. The literal expands here
when an adapter+region combo ships; today only `ebay_us` is wired.

**Why** — the previous union pre-declared three adapters that were
never implemented (silent failure mode: validation accepts the value,
the dispatcher routes nowhere). Worse, it omitted the *real* axis the
codebase actually needed — eBay region (`EBAY_US` vs `EBAY_GB` vs …) —
and conflated it with the provider switch on the categories route,
producing a 422 at the eBay marketplace_id validator. Splitting
provider+region into one literal is more honest about today's reality
and forward-compat for the multi-marketplace direction.

**Wire shape**:

- All response records that carry `marketplace` now stamp `"ebay_us"`
  in place of `"ebay"` (Item, Listing, Sale, Purchase, Payout,
  Transaction, Offer, Bid, Dispute, Feedback, Message, Promotion,
  Markdown, Ad, Recommendation, Violation, Product, Cart, Feed,
  Custom/Selling Policy, RateTable, Analytics rows).
- Input `marketplace?: Optional(Marketplace)` fields keep their place
  on `*Query` / `*Create` schemas — they're the dispatch knob for the
  one-API surface; today only `ebay_us` is a valid value, the literal
  expands when more adapters ship.
- The eBay-internal `X-EBAY-C-MARKETPLACE-ID` header is no longer
  read on any `/v1/*` route. Every route translates the flipagent
  literal to the eBay marketplace_id at the adapter boundary via
  `services/shared/marketplace.ts:ebayMarketplaceId(literal)`.

**Bug fixed**: `/v1/categories` previously sent the flipagent enum
value to eBay's `commerce/taxonomy` `marketplace_id` query param,
which eBay rejects. The route now follows the same convention as
every other route + has a region-keyed cache for the category-tree id.

**`@flipagent/sdk`** — `client.categories.itemAspects(opts?)` now
types `opts.marketplace` as `Marketplace` (was `string`). All
namespace clients keep working unchanged; only the `marketplace`
discriminator on records changes value.

**`flipagent-mcp`** — taxonomy tool defaults updated (`marketplace`
default `"ebay_us"`). Tool descriptions reference the new literal.

The narrowed literal is the right shape for the multi-marketplace
direction: when StockX / eBay GB / Amazon adapters land, each ships
its literal alongside its `services/<provider>/` adapter — no schema
churn for callers, just one new union member.
