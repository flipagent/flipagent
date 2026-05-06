---
"@flipagent/types": minor
"@flipagent/sdk": minor
"flipagent-mcp": minor
---

Risk-aware evaluate: replace `expectedNetCents` single number with three honest numbers — `successNetCents` (happy path), `expectedNetCents` ((1−P_fraud) × success − P_fraud × maxLoss), `maxLossCents` (worst case). Add `risk` block carrying `P_fraud`, `withinReturnWindow`, `cycleDays`, `reason`. Rating narrows from `"buy" | "hold" | "skip"` to `"buy" | "skip"` — no middle ground; expected-net floor decides. `recommendedExit.dollarsPerDay` is now denominated over the FULL buy→cash cycle (~11d overhead + sell-leg) so fast SKUs no longer look disproportionately efficient. Removes deprecated `EvaluateOpts.expectedSaleMultiplier` and `maxDaysToSell` (both no-ops post-refactor).
