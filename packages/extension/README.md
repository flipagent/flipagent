# @flipagent/extension

Local executor for the bridge surfaces (`/v1/buy/order/*`,
`/v1/forwarder/*`, `/v1/browser/*`). The hosted flipagent API queues
jobs; this extension picks them up and runs them inside the user's
existing Chrome — their browser, their cookies, their eBay session.

**The extension is a stateless observer, not an auto-clicker.** For
the eBay buy flow it reads price, validates against the agent's cap,
shows a banner, and records the eBay order id after the user confirms
— but the user clicks Buy It Now and Confirm-and-pay themselves.
[eBay's robots.txt](https://www.ebay.com/robots.txt) is explicit:
"Checkouts are strictly for human users." The bridge transport is
built around that requirement, so the extension only handles what
isn't a click. The agent's value is BEFORE the click (find / evaluate
/ queue) and AFTER (record / reconcile / P&L), not the click itself.

Replaces the prior Playwright-based daemon; the bridge protocol on the
hosted API is unchanged so dashboards, MCP tools, and webhooks all
keep working.

## Architecture

```
hosted API (api.flipagent.dev)                          extension (this package)
  POST /v1/buy/order/checkout    ←  AI agent / SDK
  GET  /v1/bridge/poll           ──────────────────────►  background.js
                                                          (chrome.alarms 30s tick)
  POST /v1/bridge/result         ◄──────────────────────  background.js
  POST /v1/bridge/login-status   ◄──────────────────────  background.js
                                                          (chrome.cookies probe)
                                  
                                  background.js → tab → content.js
                                                         · navigates ebay.com/itm/{id}
                                                         · reads price, validates cap
                                                         · annotates page (banner)
                                                         · user clicks BIN + Confirm
                                                         · extracts eBay order id
                                                         · reports completion
```

## Build

```
cd packages/extension
npm install                # workspace install at repo root also works
npm run build              # bundles to dist/
npm run watch              # dev rebuild on change
```

## Load (dev)

1. `chrome://extensions` → enable Developer mode
2. **Load unpacked** → select `packages/extension/dist`
3. Click the extension's options page → paste your `fa_…` key →
   click **Save + pair**
4. The extension issues a bridge token, pairs the device, and the
   service worker starts polling.

## Files

- `manifest.json` — MV3 manifest. Host permissions for ebay.com + api.flipagent.dev.
- `src/background.ts` — service worker. Owns the longpoll loop, dispatches jobs to content.
- `src/content.ts` — injected on ebay.com. Drives clicks + in-page confirm modal.
- `src/options.{html,ts}` — config form.
- `src/popup.{html,ts}` — toolbar status panel.
- `src/shared.ts` — config storage + HTTP helpers.

## Selector tuning

`src/content.ts` has selector constants for reading price on the
listing page and reading total + extracting the order id on checkout
and post-purchase pages. eBay rotates the DOM occasionally; when
validation starts failing (price reads as `null`, banner doesn't
render, order id missing), patch the candidate list. Future
iteration: serve recipes from the hosted API so selector hotfixes
ship without a Web Store re-review.

## Test harness

`test-harness/` ships two scripts for exercising the bridge protocol
without a real eBay purchase:

- `test-harness/fake-ext.mjs` — Node-only bridge client. Sends the
  same payloads the real extension sends. Fastest way to validate
  `/v1/bridge/*` contract changes; usable in CI. Subcommands:
  `pair → login → queue → poll → result → status`.
- `test-harness/playwright-launcher.mjs` — boots real Chromium with
  this extension loaded so you can watch the service worker tick +
  content script drive ebay.com in real time.

See [test-harness/README.md](test-harness/README.md) for full usage.
