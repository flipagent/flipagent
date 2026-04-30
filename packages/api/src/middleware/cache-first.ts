/**
 * Hono middleware sugar for "GET → check cache → else passthrough →
 * write cache" routes (Commerce Taxonomy, Commerce Catalog, Sell
 * Metadata). Internally delegates to the shared `withCache` HOF so
 * the cache flow has one canonical implementation across services
 * and middleware.
 *
 * Use this when the route is a pure passthrough to eBay REST and the
 * response is near-static (so caching pays). The data source is
 * always `"rest"` for these — passthroughs go through
 * `ebayPassthroughApp` / `ebayPassthroughUser` which always hit
 * `api.ebay.com`. We don't need to thread it through.
 *
 * Otherwise wrap a service call with `withCache(...)` directly and
 * have the route call the service.
 */

import type { Context, Next } from "hono";
import { hashQuery } from "../services/shared/cache.js";
import { renderResultHeaders } from "../services/shared/headers.js";
import { withCache } from "../services/shared/with-cache.js";

export interface CacheFirstOpts {
	/** Cache scope namespace, used for telemetry/debug only. */
	scope: string;
	/** TTL in seconds. 30+ days for category trees, 7d for aspects, 90d for EPID. */
	ttlSeconds: number;
}

class NotCacheable extends Error {
	readonly status: number;
	constructor(status: number) {
		super("not_cacheable");
		this.status = status;
	}
}

export function cacheFirst(opts: CacheFirstOpts) {
	// biome-ignore lint/suspicious/noConfusingVoidType: Hono middleware return contract uses Response | void
	return async (c: Context, next: Next): Promise<Response | void> => {
		// Only safe-method reads benefit — POST/PUT/DELETE go straight
		// through. HEAD is treated like GET (Hono normalises).
		if (c.req.method !== "GET") return next();

		const path = c.req.path;
		const queryHash = hashQuery({ q: c.req.url.split("?")[1] ?? "" });

		const result = await withCache({ scope: opts.scope, ttlSec: opts.ttlSeconds, path, queryHash }, async () => {
			await next();
			const res = c.res;
			if (!res || res.status !== 200) {
				// Skip cache write — middleware will return the live response.
				throw new NotCacheable(res?.status ?? 0);
			}
			const ct = res.headers.get("content-type") ?? "";
			if (!ct.includes("application/json")) throw new NotCacheable(res.status);
			const body = await res.clone().json();
			// All routes using this middleware are eBay REST passthroughs.
			return { body, source: "rest" as const };
		}).catch((err) => {
			if (err instanceof NotCacheable) return null;
			throw err;
		});

		if (!result) return; // live (non-cacheable) response already on c.res
		if (result.fromCache) {
			renderResultHeaders(c, result);
			return c.json(result.body as Record<string, unknown>);
		}
		// Miss path — body was just written to cache; the live response
		// is already on c.res. Add the source headers for telemetry.
		renderResultHeaders(c, result);
	};
}
