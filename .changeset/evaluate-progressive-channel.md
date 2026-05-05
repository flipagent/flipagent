---
"@flipagent/types": minor
"@flipagent/sdk": minor
---

**Progressive evaluate event channel + live consumer in the SDK.**

The evaluate pipeline now emits two parallel channels — step lifecycle
events for trace observability, and typed `partial` events that carry
incremental `EvaluatePartial` patches as state advances (item, raw
sold/active pools, preliminary digest, filter progress, confirmed
digest, evaluation). UI consumers spread the patches into outcome
state with no client-side projection.

**`@flipagent/types`** — new exports:

- `EvaluatePartial` schema + type — the incremental snapshot shape
  (item, soldPool, activePool, market, sold, active, filter,
  filterProgress, returns, meta, evaluation, preliminary).
- `FilterProgress` schema + type — `{processed, total}` chunk
  counter the matcher streams during the LLM same-product filter.
- `EvaluateJob.partial` — new field on the existing schema. Carries
  the merged `EvaluatePartial` accumulated from every partial event
  the worker has emitted so far. Polling consumers can render
  progressive UI off `GET /v1/evaluate/jobs/{id}` without subscribing
  to SSE.

**`@flipagent/sdk`** — new exports:

- `streamEvaluateJob({jobId, fetcher, signal, timeoutMs?})` —
  auth-agnostic async iterator yielding
  `{kind: "step" | "partial" | "done" | "error" | "cancelled"}`.
  Wraps the SSE stream + collapses `started → succeeded | failed`
  into a single `EvaluateStep` per key, with a polling fallback when
  the response isn't `text/event-stream`.
- `describeEvaluatePhase(partial, pending)` — single label source
  every UI surface uses for the human-readable phase string
  (`Looking up listing…`, `Verifying matches · 32/150`,
  `Crunching the numbers…`, …).
- New types: `EvaluateStep`, `EvaluateStreamEvent`,
  `EvaluateStreamError`, `EvaluateStreamOptions`, `StreamFetcher`.
- New subpath exports `@flipagent/sdk/streams` and
  `@flipagent/sdk/phase` so consumers can import only what they
  need without dragging in unrelated namespace clients
  (e.g. avoids `node:crypto` reaching the browser bundle).
- `client.evaluate.jobs.stream(id, opts?)` — convenience method on
  the bearer-token client that wires the SDK fetcher into
  `streamEvaluateJob` for you.

The wire format is additive — existing consumers keep working. No
breaking changes.
