---
"@flipagent/types": minor
---

**Bridge wire field renamed: `BridgePollJob.args.marketplace` → `args.source`.**

Two distinct concepts had collided on the same field name `marketplace`:

- The **flipagent record discriminator** (`Marketplace = "ebay_us" | …`) —
  carries provider+region on every record returned by `/v1/*`.
- The **bridge dispatch source** (`BridgeJobSource = "ebay" |
  "planetexpress" | "control" | "browser" | "ebay_data"`) — tells the
  Chrome extension which handler to dispatch to. Provider-only or
  function category, not provider+region. `ebay` here means the eBay
  site handler regardless of region.

The wire field on `/v1/bridge/poll` now spells the bridge concept
correctly: `args.source` (matches the `bridge_jobs.source` DB column
and the `BridgeJobSource` enum). The duplicated `BridgeMarketplace`
enum is removed; consumers reuse `BridgeJobSource` instead.

This is wire-level breaking for the Chrome extension: bumped to
manifest 0.1.1 (auto-published via the existing
`publish-extension.yml` workflow). The api revision and the
extension Web Store push roll together — old extension builds polling
the new api see a missing field and fail their next dispatch (they
read `job.args.marketplace`); the auto-update window re-syncs them
within hours.
