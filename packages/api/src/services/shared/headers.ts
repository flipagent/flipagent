/**
 * Shared header rendering for routes that return a `FlipagentResult`.
 * Emits cache state only — caller-actionable info ("you got stale data
 * from cache" → caller can decide to retry):
 *
 *   X-Flipagent-From-Cache  "true" when fromCache, omitted otherwise
 *   X-Flipagent-Cached-At   ISO timestamp when fromCache
 *
 * Transport origin (`result.source`) is stashed in the Hono context as
 * `flipagentSource` for internal telemetry (`usage_events.source`) but
 * never emitted to the response — consumers shouldn't depend on which
 * upstream pipe served them, and pricing is transport-uniform.
 *
 * Routes call this exactly once before `c.json(result.body)`.
 */

import type { Context } from "hono";
import type { FlipagentResult, SourceKind } from "./result.js";

declare module "hono" {
	interface ContextVariableMap {
		/**
		 * Origin transport of the response body, stashed by
		 * `renderResultHeaders` for internal telemetry only — never emitted
		 * to the response. Stays undefined for routes that don't return a
		 * `FlipagentResult` (e.g. /v1/me/*, /v1/keys/*).
		 */
		flipagentSource?: SourceKind;
	}
}

export function renderResultHeaders<T>(c: Context, result: FlipagentResult<T>): void {
	c.set("flipagentSource", result.source);
	if (result.fromCache) {
		c.header("X-Flipagent-From-Cache", "true");
		if (result.cachedAt) c.header("X-Flipagent-Cached-At", result.cachedAt.toISOString());
	}
}
