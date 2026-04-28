# @flipagent/extension

Local executor for `/v1/orders/*`. The hosted flipagent API queues
purchase orders; this extension picks them up and drives the eBay buy
flow inside the user's real Chrome session — same TLS fingerprint,
same cookies, same user the seller already trusts. Akamai bot detection
sees a normal session.

Replaces the prior Playwright-based daemon; the bridge protocol on the
hosted API is unchanged so dashboards, MCP tools, and webhooks all
keep working.

## Architecture

```
hosted API (api.flipagent.dev)                          extension (this package)
  POST /v1/orders/checkout       ←  AI agent / SDK
  GET  /v1/bridge/poll           ──────────────────────►  background.js
                                                          (chrome.alarms 30s tick)
  POST /v1/bridge/result         ◄──────────────────────  background.js
  POST /v1/bridge/login-status   ◄──────────────────────  background.js
                                                          (chrome.cookies probe)
                                  
                                  background.js → tab → content.js
                                                         · navigates ebay.com/itm/{id}
                                                         · reads price, clicks BIN
                                                         · in-page confirm modal
                                                         · clicks Confirm and pay
                                                         · returns order id
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

`src/content.ts` has selector constants for price / Buy It Now / Confirm
and pay. eBay rotates the DOM occasionally; when a flow starts failing
with `buy_it_now_not_found` or `confirm_and_pay_not_found`, patch the
candidate list. Future iteration: serve recipes from the hosted API so
selector hotfixes ship without a Web Store re-review.
