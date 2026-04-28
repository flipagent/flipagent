# Legal incident response — internal SOP

Internal-only. This is the runbook for responding to C&D letters, DMCA notices,
regulatory inquiries, lawsuit threats, and platform-driven blocks against
flipagent's scraping operation. The point of this document is **make the first
hour fast and the first 24 hours boringly correct**, because the cases say the
same thing every time: post-notice scraping is the single biggest unforced
contract / §502 risk we run (*Southwest Airlines v. BoardFirst*, *Craigslist v.
3Taps*, *Facebook v. Power Ventures*).

If you are reading this because something just happened: **do steps 1–4 in
order before anything else.**

---

## 1. Trigger types — recognize which you have

| Trigger | What it looks like | Skip to |
|---|---|---|
| **Cease-and-desist letter** | Email or letter from eBay legal, outside counsel, or another platform demanding we stop scraping | §3 |
| **DMCA §512(c)(3) takedown** | Notice naming a copyrighted work (photo, listing description) and demanding removal | §4 |
| **GDPR / CCPA / DPA inquiry** | Email from a regulator, DPA, AG office, or EU representative invoking Art. 15 / 17 / 21 / §1798.105 | §5 |
| **Lawsuit / TRO** | Served complaint, summons, TRO motion. PDF in email or process server in person | §6 |
| **Platform IP-block** | eBay starts returning 403/429/captcha at scale; not a legal trigger but often paired with a C&D | §7 |
| **Regulatory subpoena / law enforcement** | Subpoena, search warrant, or criminal-process | §8 |

If you cannot tell which of the above you have, treat it as a C&D and start at §3.

---

## 2. Hour-zero — the first 60 minutes (every trigger)

Before doing anything substantive, the engineer who saw it first does these
in order:

1. **Do not reply.** Do not post on Twitter, Slack public channels, or HN.
   No engineer-level response goes out. Acknowledgment is fine; substantive
   reply is not, until §3-step-3 is complete.
2. **Preserve.** Save the original message + headers. Forward the email
   verbatim to `legal-incidents@flipagent.dev` (or paste into the
   `#legal-incidents` Slack channel). Do **not** delete, edit, or
   "summarize" — preserve the original.
3. **Stop scraping affected items.** If the trigger names specific itemIds,
   sellers, queries, or routes, run the takedown blocklist:

   ```bash
   curl -X POST https://api.flipagent.dev/v1/takedown \
     -H 'Content-Type: application/json' \
     -d '{"itemId":"<id>","kind":"seller_optout","contactEmail":"legal-incidents@flipagent.dev","reason":"<trigger ref>"}'
   ```

   For platform-wide triggers (eBay legal C&D), pause search-path scraping
   entirely while §3 runs. The flag lives in `packages/api/src/proxy/scrape.ts`
   — set `SCRAPE_PAUSE=1` in the Container App env.
4. **Notify.** Page the founder + outside counsel. Outside counsel contact
   is at the bottom of this document (§10). A 5-minute call beats a
   2-hour Slack thread.

Steps 1–4 should take under 60 minutes. **Do not under any circumstances
continue scraping the named routes / itemIds while waiting for counsel.**
Continued post-notice scraping is the fact pattern that converts a survivable
ToS dispute into actionable contract / §502 liability (*3Taps*, *BoardFirst*,
*Power Ventures*).

---

## 3. Cease-and-desist letter

After §2, with counsel on the call:

1. **Confirm what's being demanded.** Most C&Ds ask for one or more of:
   stop scraping (all / specific paths / specific accounts), delete cached
   data, identify customers, accept service of process. Note which.
2. **Apply requested blocklist within 5 business days.** This matches our
   public commitment in `apps/docs/src/pages/legal/compliance.astro` ("we
   do not ignore C&D notices"). The blocklist is operationally the same as
   approved takedowns: cache flush + itemId blocklist + scrape skip.
3. **Send a 24-hour acknowledgment** (template in §11). The acknowledgment
   confirms receipt + states we are reviewing + identifies counsel of record.
   It does not concede facts and does not argue substance.
4. **Counsel-led response.** All substantive responses go out through
   counsel. Engineer-drafted replies are reviewed by counsel before send.
5. **Decision: stop, narrow, or contest.** Counsel + founder decide whether
   to (a) stop the disputed conduct entirely, (b) narrow to a defensible
   subset (e.g., keep `/itm/{itemId}` direct fetches, drop `/sch/`), or
   (c) push back on the legal theory. The default for first-letter C&Ds
   is (a) or (b); (c) requires counsel's explicit OK.
6. **Document the decision.** Write up what we changed, when, and why, in
   `docs/legal/incidents/<YYYY-MM-DD>-<sender>.md`. Include the original
   notice, our acknowledgment, our actions taken, and counsel's recorded
   advice.

---

## 4. DMCA §512(c)(3) takedown

DMCA notices have a stricter form requirement than generic C&Ds. The §512(c)(3)
elements: (a) signature, (b) identification of copyrighted work, (c)
identification of allegedly infringing material with locator (URL/itemId),
(d) sender contact info, (e) good-faith statement, (f) accuracy statement
under penalty of perjury.

1. Forward the notice to `dmca@flipagent.dev` (the registered DMCA agent
   email; see `apps/docs/src/pages/legal/compliance.astro`).
2. Verify the §512(c)(3) elements are present. **Missing elements** — return
   to sender for completion rather than treat as defective. Reply template
   in §11.
3. **Complete elements** — process via `/v1/takedown` with
   `kind: "dmca_copyright"`. The handler flushes cache + blocklists the
   itemId. Aim for under 48 business hours per our public SLA.
4. **Counter-notice** — if the affected seller / counter-noticer claims fair
   use, follow §512(g): hold the action 10 business days and restore unless
   a court order arrives. Counter-notices go to counsel.
5. **Repeat infringer policy** — eBay seller accounts that get multiple
   sustained takedowns enter a permanent blocklist. Track in the
   `takedown_requests` table.

---

## 5. GDPR / CCPA / regulatory inquiry

1. Forward to `privacy@flipagent.dev` (or `legal-incidents@flipagent.dev` for
   now if that alias is not yet provisioned). Note: the EU Art. 27
   representative, if/when we appoint one, also receives these.
2. **Identify which right is being invoked**:
   - Art. 15 access → DSAR. Gather all rows keyed to the data subject's
     identifier and produce within 30 days.
   - Art. 17 erasure → same pipeline as `/v1/takedown` with
     `kind: "gdpr_erasure"`.
   - Art. 21 objection → same pipeline.
   - CCPA §1798.105 deletion → `kind: "ccpa_deletion"`.
3. **Verify the requester** — for cached eBay seller data, the eBay
   username + a method to confirm control (e.g., email matching the
   account, or a screenshot of an active eBay listing) is sufficient.
   Don't process anonymous mass-takedown bulk requests without
   verification — that's a vector for griefing.
4. **Statutory windows**: GDPR Art. 12(3) — 1 month, extendable to 3 with
   notice. CCPA — 45 days, extendable to 90 with notice. Don't blow these.
5. **Lodge of complaint** — if the requester is escalating to a DPA, treat
   it as a §3 C&D in parallel: counsel involved, written response, log.

---

## 6. Lawsuit, TRO, or formal complaint

1. **Confirm authenticity.** Real complaints come with a docket number,
   court venue, and either certified mail / process server / electronic
   service via PACER notification. Internet-circulated screenshots are not
   service.
2. **Engage counsel immediately.** This is the only trigger where the
   founder's response window is hours, not days. TROs can be argued ex
   parte; appearance windows are statutory and short.
3. **Litigation hold** — preserve all relevant records (logs, scrape
   traffic, emails, Slack). Suspend any automated retention deletion that
   would touch the relevant time window. Tell engineering: do not delete,
   do not edit, do not "clean up."
4. **PR posture** — no public statement until counsel approves. "We don't
   comment on pending litigation" is the answer to all media inquiries.
5. **Discovery** — once counsel takes over, follow their preservation +
   production instructions exactly. Engineering's role is to produce
   accurate, well-organized records and to not improvise.

---

## 7. Platform IP-block (no legal trigger)

If eBay starts returning 403/429/CAPTCHA at scale without a paired C&D, this
is operational, not legal. But it is often the **precursor** to a C&D; the
block is the platform's first signal. Document it.

1. Don't escalate the cat-and-mouse. **Do not** rotate to a more aggressive
   evasion (CAPTCHA solver, browser-fingerprint randomization, JS
   anti-bot bypass). That would move us into DMCA §1201 territory.
2. **Slow down** — drop scrape rate, increase cache TTL temporarily, route
   through more residential IPs at lower per-IP volume.
3. Log the block pattern in `docs/legal/incidents/<YYYY-MM-DD>-platform-block.md`
   so if a C&D arrives later, we have contemporaneous notes about what
   pattern we saw and what we did.
4. If the block becomes total (>90% requests fail for >24h), pause the
   service for affected paths and notify customers via status page. Don't
   continue at scale into a hostile platform.

---

## 8. Subpoena or law enforcement process

1. **Authenticate**. Real subpoenas have a court name, case caption, ECF
   number, and a clearly named issuing attorney or AUSA. Email subpoenas
   are often phishing.
2. **Counsel before any production.** Some subpoenas request data we
   cannot legally produce (privileged, out-of-scope, overbroad).
3. **Customer notice** — if the subpoena targets a specific customer's
   API key activity, our policy is to notify that customer unless the
   subpoena includes a non-disclosure order. Counsel will read the
   instrument and tell us.
4. **National security letters / FISA process** — if any of these arrive,
   counsel handles entirely. Engineering does not respond directly.

---

## 9. Don't-do list

Things that have lost cases for other scrapers and would lose them for us:

- ❌ **Continue scraping the disputed paths after notice.** Single biggest
  unforced loss vector. *Power Ventures*, *3Taps*, *BoardFirst*.
- ❌ **Delete or modify logs** in response to notice. Spoliation. Sanctions
  far worse than the underlying claim.
- ❌ **Send a clever lawyer-y reply yourself.** Engineer-authored legal
  argument is a discovery exhibit waiting to happen. Counsel only.
- ❌ **Argue substance on social media.** No tweets, no HN comments, no
  Reddit threads. Public statements are admissions.
- ❌ **Create new accounts to keep scraping.** That's the *hiQ v. LinkedIn*
  consent-decree trigger and we lose every defense built around our
  logged-out posture.
- ❌ **Solve the CAPTCHA.** No CAPTCHA-solving services, no Stealth
  plugins, no fingerprint randomization. DMCA §1201 is the live battleground.
- ❌ **Forget the 24-hour acknowledgment.** Silence on a C&D for >72 hours
  reads as bad faith and changes how counsel can negotiate.

---

## 10. Outside counsel contact

> Filled in once retained. Do not commit real names + numbers in plain text
> here — that creates a phishing target. Store the actual contact in 1Password
> shared vault (`flipagent-legal`) and reference here:

- **Primary outside counsel** (US litigation): _see 1Password `flipagent-legal/counsel-primary`_
- **DMCA agent of record**: Jinho Kim, [dmca@flipagent.dev](mailto:dmca@flipagent.dev) (registered with U.S. Copyright Office, 17 U.S.C. §512(c)(2))
- **EU Art. 27 representative**: not yet appointed (deferred until EU customer base material)
- **Founder cell** (24h reachable for true emergencies): _see 1Password `flipagent-legal/founder-cell`_

---

## 11. Templates

### Template A — 24-hour C&D acknowledgment

> _To: counsel for sender_
> _Subject: Receipt acknowledged — [sender ref / matter name]_
>
> Counsel,
>
> This message confirms flipagent's receipt of your letter dated [date],
> regarding [brief subject — e.g., "scraping of eBay public listings"]. We
> are reviewing the matter with counsel and will respond substantively
> within [10 business days / by date].
>
> In the interim, we have applied a precautionary blocklist on the
> specific itemIds, sellers, or routes you identified, pending the
> substantive review. This action is without prejudice to any defense or
> position we may take.
>
> Please direct further correspondence to [counsel email] with a copy to
> legal-incidents@flipagent.dev.
>
> Regards,
> Jinho Kim
> Founder, flipagent

### Template B — DMCA notice missing elements

> _To: notice sender_
>
> Thank you for your DMCA notice dated [date]. To process it under 17
> U.S.C. §512(c)(3), we require the following elements that appear to be
> missing or incomplete:
>
> - [ ] Identification of the copyrighted work claimed to be infringed
> - [ ] Identification of the allegedly infringing material with sufficient
>       locator (eBay itemId or URL)
> - [ ] Your contact information (address, telephone, email)
> - [ ] Statement of good-faith belief
> - [ ] Statement under penalty of perjury that the information is accurate
>       and you are authorized to act on the rights holder's behalf
> - [ ] Physical or electronic signature
>
> Please reply to dmca@flipagent.dev with the missing elements and we will
> process the notice within our published 48-business-hour SLA.

### Template C — Customer subpoena notice (when permitted)

> _To: API customer affected by subpoena_
>
> flipagent has received a subpoena from [issuing party] requesting
> records related to your account activity between [date range]. Unless
> a non-disclosure order is in effect (none has been served on us as of
> this notice), we are required to produce responsive records by [date].
>
> If you wish to challenge the subpoena, you should engage counsel
> immediately. Our policy is to wait until [date] before producing,
> giving you a reasonable opportunity to seek a protective order.

---

## 12. Updating this document

Update when:

- We retain or change outside counsel.
- We register or change the DMCA designated agent at copyright.gov.
- We appoint or change an EU Art. 27 representative.
- A real incident teaches us something this runbook didn't anticipate —
  add a section, with the date and a one-line trigger description.

Track changes in git history. The doc is intentionally not in the public
docs site; it lives in this internal `docs/legal/` tree.
