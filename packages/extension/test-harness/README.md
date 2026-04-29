# Extension test harness

Two ways to exercise the bridge protocol without making a real eBay
purchase. They complement each other: the **fake-ext** script
validates the *server-side* contract (pair → login → poll → result)
without a browser; the **Playwright launcher** boots real Chrome with
the extension loaded so you can watch the *client-side* DOM driving
in real time.

## fake-ext.mjs — Node, no browser

A standalone bridge client. Sends the same payloads the real
extension sends; useful for CI, local smoke tests, or reproducing a
failing job by hand.

```bash
export FLIPAGENT_BASE_URL=http://localhost:4001
export FLIPAGENT_API_KEY=fa_free_…   # any flipagent key paired against this host

node fake-ext.mjs reset            # clear local state
node fake-ext.mjs pair             # POST /v1/bridge/tokens     → get fbt_… token
node fake-ext.mjs login alice      # POST /v1/bridge/login-status (loggedIn=true, user=alice)
node fake-ext.mjs queue 12345                # POST /v1/buy/order/checkout_session/initiate + …/place_order
node fake-ext.mjs poll             # GET  /v1/bridge/poll       → claim the job (200 + payload, or 204 idle)
node fake-ext.mjs result <jobId> placing                          # intermediate
node fake-ext.mjs result <jobId> completed --ebayOrderId 09-1-2 --totalCents 4895
node fake-ext.mjs status <purchaseOrderId> # GET /v1/buy/order/purchase_order/{id} → eBay-shape state
```

State (token, last job, last orderId) lives in
`~/.flipagent/test-harness.json` so each subcommand is independent.
Run `node fake-ext.mjs show` to inspect.

What it covers:

| Step | Endpoint | Auth |
|---|---|---|
| `pair` | `POST /v1/bridge/tokens` | api key |
| `login` | `POST /v1/bridge/login-status` | bridge token |
| `poll` | `GET /v1/bridge/poll` (longpoll up to 25s) | bridge token |
| `result` | `POST /v1/bridge/result` | bridge token |
| `queue` | `POST /v1/buy/order/checkout_session/initiate` + `POST /…/{sessionId}/place_order` (convenience to put a job in front of `poll`) | api key |
| `status` | `GET /v1/buy/order/purchase_order/{id}` (convenience) | api key |

After `pair` + `login`, `GET /v1/connect/ebay/status` shows
`bridge.paired: true, bridge.ebayLoggedIn: true` exactly as it would
for a real Chrome client.

## playwright-launcher.mjs — real Chrome, full DOM driving

Spawns Chromium with `packages/extension/dist` loaded as an unpacked
extension. Watch the service worker tick, the side panel render, and
the content script attach to ebay.com pages.

```bash
# one-time
npm i -D playwright && npx playwright install chromium

# every run
FLIPAGENT_BASE_URL=http://localhost:4001 node playwright-launcher.mjs
```

What it does:

1. Builds the extension if `dist/` is missing.
2. Launches Chromium **headed** (MV3 service workers don't run in pure
   headless mode).
3. Pipes service-worker + page console logs into your terminal so you
   can see `[ext:bg]` / `[chrome:console]` traffic live.
4. Opens the side panel (paste your `fa_…` key + click pair) and
   `https://www.ebay.com/` (so the content script attaches and you
   can sign into your real eBay account if you want a full live-fire
   run).
5. Holds open until Ctrl-C.

Pair the launcher's extension to your **local** flipagent (4000 /
4001), not prod, and queue jobs at it from a second terminal:

```bash
node fake-ext.mjs queue 123456789012
```

The extension polls every 30s, so the queued job lands within one
alarm tick — you'll see the content script open the eBay listing
URL and start clicking. Don't follow the buy flow all the way to
"Confirm and pay" unless you mean it.

## Caveats

- **Don't ship test traces to prod.** The fake-ext harness posts
  `bridge.deviceName: fake-ext-harness` so it's easy to recognise and
  delete from `bridge_tokens`.
- The Playwright launcher writes a Chrome profile under
  `packages/extension/.playwright-profile` so it remembers your eBay
  login between runs. Delete that folder to start clean.
- `chrome.alarms` minimum period is 30s in production. The launcher
  uses a real Chrome build, so don't expect faster ticks unless you
  patch `POLL_PERIOD_MIN` in `src/background.ts`.
