/**
 * Shared header rendering for routes that return a `FlipagentResult`.
 * One canonical mapping from envelope → response headers:
 *
 *   X-Flipagent-Source      always set, the data origin
 *   X-Flipagent-From-Cache  "true" when fromCache, omitted otherwise
 *   X-Flipagent-Cached-At   ISO timestamp when fromCache
 *
 * Also stashes `result.source` in the Hono context as `flipagentSource`
 * so `requireApiKey` can read it post-handler and bill transport-aware
 * (rest=1c vs scrape=2c on the same endpoint) without re-deriving it.
 *
 * Routes call this exactly once before `c.json(result.body)`.
 */

import type { Context } from "hono";
import type { FlipagentResult, SourceKind } from "./result.js";

declare module "hono" {
	interface ContextVariableMap {
		/**
		 * Origin transport of the response body, set by `renderResultHeaders`.
		 * Read by `requireApiKey` to compute `credits_charged` per call. Stays
		 * undefined for routes that don't return a `FlipagentResult` (e.g.
		 * /v1/me/*, /v1/keys/*) — those have no upstream and bill 0.
		 */
		flipagentSource?: SourceKind;
	}
}

export function renderResultHeaders<T>(c: Context, result: FlipagentResult<T>): void {
	c.header("X-Flipagent-Source", result.source);
	c.set("flipagentSource", result.source);
	if (result.fromCache) {
		c.header("X-Flipagent-From-Cache", "true");
		if (result.cachedAt) c.header("X-Flipagent-Cached-At", result.cachedAt.toISOString());
	}
}
