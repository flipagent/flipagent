/**
 * `fetch` with one retry on transient transport failures. Drops in
 * anywhere `globalThis.fetch` would, with the same signature.
 *
 * Triggers:
 *   - thrown network error (undici "fetch failed", DNS timeout, ECONNRESET)
 *   - HTTP 502 / 503 / 504 from upstream
 *
 * Stays quiet on 4xx, 401/403, 429 — those are deterministic answers,
 * not transport blips, and re-issuing the request would just burn budget.
 *
 * One retry only, 250ms gap. Beyond that the underlying issue isn't
 * a blip and a retry won't fix it — better to surface the failure to
 * the caller than to mask a real problem behind a longer wait.
 */

import fetchBuilder from "fetch-retry";

export const fetchRetry: typeof fetch = fetchBuilder(globalThis.fetch, {
	retries: 1,
	retryDelay: 250,
	retryOn: [502, 503, 504],
}) as typeof fetch;
