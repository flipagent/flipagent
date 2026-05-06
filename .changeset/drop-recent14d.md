---
"@flipagent/types": minor
"@flipagent/sdk": patch
"flipagent-mcp": patch
---

Drop `recent14dMedianCents` from `MarketStats` and `SoldDigest`. Anchor selection collapses to the full-window median; callers control recency via `lookbackDays`. The recent-14d cutoff was statistically thin (4–7 obs) and pulled the anchor between price clusters in bimodal pools without giving an honest "current market" signal.
