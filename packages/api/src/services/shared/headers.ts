/**
 * Shared header rendering for routes that return a `FlipagentResult`.
 * One canonical mapping from envelope → response headers:
 *
 *   X-Flipagent-Source      always set, the data origin
 *   X-Flipagent-From-Cache  "true" when fromCache, omitted otherwise
 *   X-Flipagent-Cached-At   ISO timestamp when fromCache
 *
 * Routes call this exactly once before `c.json(result.body)`.
 */

import type { Context } from "hono";
import type { FlipagentResult } from "./result.js";

export function renderResultHeaders<T>(c: Context, result: FlipagentResult<T>): void {
	c.header("X-Flipagent-Source", result.source);
	if (result.fromCache) {
		c.header("X-Flipagent-From-Cache", "true");
		if (result.cachedAt) c.header("X-Flipagent-Cached-At", result.cachedAt.toISOString());
	}
}
