/**
 * Cache HOF used by every service that fronts an upstream and wants
 * lazy persistence in `proxy_response_cache`. One canonical
 * implementation of "look up → if hit return → else run fetcher with
 * a deadline → write cache → return". Keeps cache logic out of
 * services and out of routes.
 *
 *   const result = await withCache(
 *     { scope: "listings:active", ttlSec: 60 * 60, path, queryHash },
 *     async () => {
 *       const body = await dispatchToUpstream();
 *       return { body, source: "rest" };
 *     },
 *   );
 *   // result : FlipagentResult<typeof body>
 *
 * `scope` is for telemetry / debug only — it's the call-site
 * namespace ("listings:active", "match:hosted", "taxonomy:tree").
 * It does NOT affect the cache key (path + queryHash own the key)
 * and does NOT leak into the `source` field of the result. The
 * returned envelope's `source` is always the real upstream kind
 * (`rest` | `scrape` | `bridge` | `trading` | `llm`), with
 * `fromCache` flipping to true on a hit.
 *
 * Cache writes are fire-and-forget (logged on failure). Fetcher
 * exceptions propagate so callers can map them to ListingsError
 * etc. The fetcher gets `timeoutMs` (default 20s) so a hung
 * upstream can't pin the route handler indefinitely.
 */

import { getCached, setCached } from "./cache.js";
import { coerceSourceKind, type FlipagentResult, type SourceKind } from "./result.js";

export interface WithCacheArgs {
	scope: string;
	ttlSec: number;
	path: string;
	queryHash: string;
	/** Upstream deadline. Default 20s. */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function withCache<T>(
	args: WithCacheArgs,
	fetcher: () => Promise<{ body: T; source: SourceKind }>,
): Promise<FlipagentResult<T>> {
	const cached = await getCached<T>(args.path, args.queryHash).catch(() => null);
	if (cached) {
		return {
			body: cached.body,
			source: coerceSourceKind(cached.source),
			fromCache: true,
			cachedAt: cached.createdAt,
		};
	}
	const fresh = await withTimeout(fetcher(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.scope);
	await setCached(args.path, args.queryHash, fresh.body, fresh.source, args.ttlSec).catch((err) =>
		console.error(`[withCache:${args.scope}] cache set failed:`, err),
	);
	return { body: fresh.body, source: fresh.source, fromCache: false };
}

export class UpstreamTimeoutError extends Error {
	readonly scope: string;
	readonly timeoutMs: number;
	constructor(scope: string, timeoutMs: number) {
		super(`upstream timeout in ${scope} after ${timeoutMs}ms`);
		this.name = "UpstreamTimeoutError";
		this.scope = scope;
		this.timeoutMs = timeoutMs;
	}
}

async function withTimeout<T>(p: Promise<T>, ms: number, scope: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			p,
			new Promise<T>((_, rej) => {
				timer = setTimeout(() => rej(new UpstreamTimeoutError(scope, ms)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
