# Chrome Web Store submission — flipagent

Paste-ready copy for the CWS Developer Dashboard. Sections follow
the dashboard tabs (Product details → Privacy practices → Distribution).

---

## Tab: Product details

### Title (read from manifest)

    flipagent

### Summary (read from manifest)

    flipagent evaluates eBay listings as flip opportunities. This extension lets the AI act on them in your own Chrome.

### Detailed description

flipagent tells you on the eBay page itself whether a listing is
statistically worth flipping.

A chip appears next to each item's price on search results. Click
it to get an estimated net profit if you bought at the listed price
and resold, built from:

  • Recent sold history: median, distribution, sell-through,
    days-to-sell
  • Currently active listings: how much supply is competing and at
    what prices
  • eBay fees, shipping, and your cost basis subtracted out

On the item page, the same estimate expands into a full breakdown:
sold comp set, active comp set, suggested resale price band,
projected margin range.

Why install it:

  • The math runs the second you see a listing, not after you've
    bought it.
  • The estimate appears where you're already shopping. No
    dashboard, no copy-pasting item ids.
  • Evaluate from search, then open the item page. Same estimate,
    no re-run, no double credits.

You'll need a flipagent account and an API key. Free tier at
https://flipagent.dev. The extension reads listing prices and runs
evaluations against your account. It never stores your eBay
password and never completes checkout for you.

### Category

    Productivity

### Language

    English (United States)

### Graphic assets

| Slot | File |
|---|---|
| Store icon (128x128) | store-assets/store-icon-128x128.png |
| Screenshot 1 (1280x800) | store-assets/screenshot-real-itempage-1280x800.png |
| Screenshot 2 | store-assets/screenshot-1-overview-1280x800.png |
| Screenshot 3 | store-assets/screenshot-2-bridge-1280x800.png |
| Screenshot 4 | store-assets/screenshot-3-cycle-1280x800.png |
| Small promo tile (440x280) | store-assets/promo-tile-440x280.png |
| Marquee promo tile (1400x560) | store-assets/marquee-tile-1400x560.png |

### Additional fields

| Field | Value |
|---|---|
| Official URL | None |
| Homepage URL | https://flipagent.dev |
| Support URL | https://flipagent.dev |
| Mature content | No |
| Item support visibility | On |

---

## Tab: Privacy practices

### Single purpose description

    Show flipagent's net-profit estimate for an eBay listing in-page, by reading the listing's price and querying the user's flipagent account for sold-history and active-listing statistics.

### storage justification

    Stores the user's flipagent API key and per-item evaluation results locally in chrome.storage so estimates persist across pages and across browser restarts without re-querying the backend.

### alarms justification

    The MV3 service worker cannot hold a persistent timer. chrome.alarms wakes the worker on a fixed interval to refresh evaluation state and check pending background jobs.

### tabs justification

    Identifies the active eBay tab so the evaluation result attaches to the correct page when the user clicks the in-page chip on a search result or item page.

### scripting justification

    Programmatically injects the evaluation chip and result UI into eBay search and item pages on demand, instead of running content code on every pageview.

### sidePanel justification

    Renders the flipagent panel in Chrome's side panel so the user can see the full evaluation breakdown (sold comp set, active comp set, suggested resale price band, projected margin) without leaving the eBay tab.

### cookies justification

    Reads the eBay session indicator cookie on ebay.com to detect whether the user is signed in. The popup uses this to show "ready" vs "sign in to eBay first." Cookie values are not transmitted off the device.

### notifications justification

    Shows a Chrome notification when a long-running evaluation finishes in the background, so the user does not need to keep the eBay tab focused while the comp set is being computed.

### Host permission justification

    The extension only runs on three hosts. ebay.com: read listing price and mount the in-page evaluation chip on /sch/ and /itm/ pages. planetexpress.com: read package metadata for users who use the Planet Express forwarder integration with their flipagent account. flipagent.dev: talk to the user's own flipagent backend to fetch evaluations and report state. No all_urls, no wildcard hosts.

### Remote code

    Select: No, I am not using Remote code

### Data usage — check exactly these two boxes

  • Authentication information         (the user's flipagent API key, stored locally; transmitted only to the user's own flipagent backend)
  • Website content                    (reads price and item id from eBay pages the user opens; transmitted only to the user's own flipagent backend)

All other 7 boxes: leave UNCHECKED.

### Certifications — check all three

  • I do not sell or transfer user data to third parties, outside of the approved use cases
  • I do not use or transfer user data for purposes that are unrelated to my item's single purpose
  • I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

    https://flipagent.dev/legal/privacy/

---

## Tab: Distribution

| Field | Value |
|---|---|
| Visibility | Public |
| Regions | All regions |

---

## Automation (after the first manual upload)

The first version (0.1.0) was submitted by hand through the CWS
Developer Dashboard. From here on, `.github/workflows/publish-extension.yml`
auto-uploads + auto-publishes when **`packages/extension/manifest.json`'s
`version` field changes** on a push to `main`. Code-only changes that
don't bump the manifest version skip the upload (so we don't burn
through CWS review submissions for in-flight WIP).

### Release flow

1. Make whatever extension changes.
2. Bump `packages/extension/manifest.json` → `version` (semver, e.g.
   `0.1.0` → `0.1.1`).
3. Commit + push to `main`. The workflow detects the bump, runs
   `npm run build`, zips `packages/extension/dist/`, uploads via the
   CWS API, and requests publish.
4. CWS still gates the published revision behind their review queue
   (typically minutes to a few days) — that part isn't automatable.

To force a re-upload of the same version (rare — usually only for an
asset-only change), use **Actions → Publish Chrome Extension → Run
workflow** with `force=true`.

### Local zip

`npm run -w @flipagent/extension zip` produces
`packages/extension/flipagent-<version>.zip` for sideloading or
manual upload. Re-buildable; gitignored.

### Required GitHub secrets

Set these once in **Settings → Secrets and variables → Actions**:

| Secret | What it is |
|---|---|
| `CHROME_EXTENSION_ID`  | Listing id from the CWS Dashboard URL after the first manual upload (32-char lowercase). |
| `CHROME_CLIENT_ID`     | OAuth 2.0 client id, type **Desktop app**, from Google Cloud Console → APIs & Services → Credentials. The project must have the **Chrome Web Store API** enabled. |
| `CHROME_CLIENT_SECRET` | OAuth client secret paired with the id above. |
| `CHROME_REFRESH_TOKEN` | Long-lived refresh token for scope `https://www.googleapis.com/auth/chromewebstore`, generated once via the OAuth code flow (the `chrome-webstore-upload-cli` README and Google's [`Using Refresh Tokens`](https://developers.google.com/identity/protocols/oauth2/native-app) doc both walk through it). |

The OAuth account that minted the refresh token must be a
**publisher** (or co-publisher) on the CWS listing. Personal Google
accounts work — no Workspace org needed.

### Why version-bump-gated rather than every-push

CWS rejects identical version uploads, and review queue throughput
is a finite resource. Gating on the `manifest.json` version makes
the publish a deliberate act ("I bumped → I meant to ship") instead
of a side effect of any push. The sibling `release.yml` workflow
uses the same pattern via Changesets for npm packages.
