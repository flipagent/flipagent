# Compliance — internal repo notes

Engineering-side notes on the operational/legal posture of `@flipagent/ebay-scraper`
and `@flipagent/api`. The user-facing version of this lives at
[`apps/docs/src/pages/legal/compliance.astro`](../../apps/docs/src/pages/legal/compliance.astro)
(rendered at `flipagent.dev/legal/compliance`) and that is the document
external parties should read. This file exists so the references in source
code (e.g. `packages/ebay-scraper/src/robots-guard.ts:12`) resolve to a real
file and so contributors understand the constraints behind the code-level
guards.

For incident response (C&D, DMCA, subpoena, etc.) see
[`incident-response.md`](./incident-response.md) in this folder — that is
the internal SOP and it is intentionally not published.

## The one knowing exception: `/sch/i.html`

eBay's `robots.txt` v24.5 (December 2025) lists `/sch/i.html` under the
`User-agent: *` Disallow block. `@flipagent/ebay-scraper` fetches this path
to read keyword search results. Every other Disallow pattern in that block
is rejected by `assertUrlAllowed()` before the request leaves the process —
this one we knowingly do not.

Why we operate on it anyway:

- **No legitimate substitute.** Sold-comp aggregation has no equivalent
  channel for tenants without Marketplace Insights API access. eBay's
  Marketplace Insights program is Limited Release with high rejection
  rates for new applicants, and there is no buyable commercial sold-data
  feed at the time of writing. A deal-finding product without sold-comp
  data is not a product.
- **Robots.txt is a notice signal, not a contract.** *hiQ Labs v.
  LinkedIn* (9th Cir. 2022) and *Meta v. Bright Data* (N.D. Cal. 2024)
  confirm that public pages on the public internet do not generate CFAA
  liability and that robots.txt-style notices do not bind non-account
  visitors. We rely on these.
- **We minimize the impact.** Hosted API: short TTL response cache
  (60 min active, 12h sold) amortizes one origin request across all
  callers. Outbound scrape traffic is delegated to a managed Web Scraper
  API (today: Oxylabs) so origin load is spread across that vendor's
  pool, not concentrated on flipagent's IPs. We never poll faster than
  necessary to serve a real user request.
- **We honor takedown signals.** `/v1/takedown` accepts seller opt-out,
  DMCA §512(c)(3), GDPR Art. 17, CCPA §1798.105. C&D notices are
  acknowledged within 24 hours per
  [`incident-response.md`](./incident-response.md).
- **Code is honest about it.** The OSS package does not pretend the path
  is unrestricted. `robots-guard.ts` documents the exception openly,
  the README warns OSS users, and the fetcher requires an explicit
  `acknowledgeRobotsException: true` opt-in before it will issue a
  `/sch/` request — a sloppy or unaware caller cannot trip the
  exception by accident.

## What is enforced in code

- `assertUrlAllowed(url)` (in `robots-guard.ts`) rejects every `User-agent: *`
  Disallow pattern other than `/sch/i.html`. Specifically: cart, seller-tools,
  sign-in, watch/feedback subpaths, action=BESTOFFER, image bytes under
  `/itm/`, `/itm/addToCart`, `/myebay`, `/feed/`, `/fdbk/`, `/ecaptcha/`,
  etc. See `DISALLOW_RULES` in that file for the full list.
- `assertUserAgentAllowed(ua)` (in `http-fetcher.ts`) rejects any
  User-Agent containing the AI-bot tokens that eBay's robots.txt
  Disallows site-wide (`bytespider`, `ccbot`, `chatglm-spider`,
  `claudebot`, `perplexitybot`, `anthropic-ai`, `amazonbot`). Sending
  any of these would be a direct, formal robots.txt violation and is
  refused before the request leaves the process.
- `fetchHtml()` requires `acknowledgeRobotsException: true` for any
  URL whose path begins with `/sch/`. Throws
  `RobotsExceptionRequiredError` otherwise.
- `fetchHtml()` detects eBay's "200 with a thin body" bot-wall pattern
  on `/sch/i.html` and throws `HttpBlockedError` rather than retrying
  or attempting to bypass — caller is expected to slow down or rotate
  proxies, not escalate evasion.
- No CAPTCHA solver, no fingerprint randomization (Canvas/WebGL/audio
  API tampering), no anti-bot JS bypass (Akamai / PerimeterX / Cloudflare
  bot management), no headless-stealth plugins. Any change that
  introduces these would move us into DMCA §1201 territory and is
  prohibited — see
  [`incident-response.md` §9 don't-do list](./incident-response.md#9-dont-do-list).

## What the hosted API adds on top of the OSS scraper

The OSS package is intentionally a thin parser; the proprietary
operational hygiene lives in `packages/api`:

- Postgres response cache (TTL: 60min active / 12h sold / 4h detail).
  Anti-thundering-herd, not archival.
- Managed scraping vendor (today Oxylabs Web Scraper API) selected via
  `SCRAPER_API_VENDOR`, with credentials in `SCRAPER_API_USERNAME` /
  `SCRAPER_API_PASSWORD`. Detection-evasion (residential rotation, JS
  rendering, anti-bot) is the vendor's responsibility — flipagent's own
  code path is a normal HTTPS client.
- Takedown blocklist: approved itemIds are flushed from cache and
  refused on subsequent fetch attempts.
- `SCRAPE_PAUSE=1` env flag for full pause during incident response.

A self-hoster running the OSS scraper directly is operating their own
instance under their own infrastructure and bears their own ToS posture.
flipagent does not direct, control, or benefit from third-party
deployments.

## Updating this document

Update when:

- eBay's `robots.txt` changes the Disallow pattern set covered by
  `DISALLOW_RULES` or by `FORBIDDEN_UA_TOKENS`. The CI baseline check
  (`packages/ebay-scraper/scripts/check-robots.ts`) flags drift; sync
  the rules and bump the baseline file when it does.
- A new path is added to the scraper. Either it must already be
  Allow under `User-agent: *`, or it lands here as a documented
  exception with the same legal/operational reasoning template.
- Case law shifts. The current posture leans on *hiQ* (9th Cir.) and
  *Bright Data* (N.D. Cal.). If these are reversed or distinguished
  in a controlling jurisdiction, revisit.
