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
 *       return { body };
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
 * upstream can't pin the route handler indefinitely. Service
 * composers that know their resolved transport should pass
 * `timeoutMsForSource(source)` so scrape/bridge get realistic
 * deadlines instead of the REST-tuned default.
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

/**
 * Per-source upstream deadline. REST is fast (eBay typically <2s); scrape
 * routes through a managed renderer (Oxylabs) that runs its own browser
 * stack and routinely takes 20-50s end-to-end; bridge polls the user's
 * Chrome extension which has its own 30s inner deadline.
 *
 * Service composers (`searchActiveListings`, `searchSoldListings`,
 * `getItemDetail`) call this with the resolved transport so the
 * `withCache` deadline matches the realistic upstream tail. Otherwise a
 * 20s default trips long-tail scrapes that would have completed in 30s.
 */
export function timeoutMsForSource(source: "rest" | "scrape" | "bridge"): number {
	switch (source) {
		case "scrape":
			// Per-call HTTP timeout (90s) lives inside the Oxylabs adapter
			// — that's what actually bounds an individual upstream call.
			// This outer deadline is just a safety net wrapping the whole
			// fetcher (which includes the in-process semaphore queue). The
			// queue wait is variable: a broad evaluate run can fan out
			// dozens of scrape calls, throttled by the 12-slot semaphore,
			// and a long-tail caller can wait minutes for its slot. We don't
			// want THAT wait to count against a fixed budget — the inner
			// 90s HTTP cap already guarantees no single call hangs. So the
			// outer is a generous 10-minute upper bound: "if the whole
			// fetcher (queue + HTTP) hasn't returned in 10 min, something
			// is genuinely stuck." Real timeouts surface from the inner
			// AbortController with a meaningful HTTP-level error.
			return 600_000;
		case "bridge":
			// 5s headroom over the bridge's inner 30s waitForTerminal so
			// the inner timeout surfaces a "bridge_timeout" with context
			// before this outer timer fires a generic upstream timeout.
			return 35_000;
		default:
			return DEFAULT_TIMEOUT_MS;
	}
}

/**
 * Per-process in-flight fetch dedup. When two callers race the same
 * uncached resource (same path + queryHash), only ONE actually runs the
 * fetcher; the rest await the same promise and share its result. Cuts
 * duplicate Oxylabs calls during request bursts (popular itemId hit by
 * multiple evaluate runs in the same second) and prevents thundering-
 * herd cache misses on cold-restart.
 *
 * Map is keyed on `${path}:${queryHash}` — same key the cache uses, so
 * an in-flight entry resolves to the same value the cache would have
 * stored. Cleared in `finally` so a failed fetch doesn't poison
 * subsequent callers.
 *
 * Per-process (not cross-replica): in a multi-replica deploy each
 * instance has its own map. That's acceptable — same-replica bursts are
 * the dominant pattern (a single user's evaluate fans out, retries on
 * the same replica via the same connection), and cross-replica dedup
 * would need a distributed lock that costs more than the savings.
 */
const inflightFetches = new Map<string, Promise<{ body: unknown; source: SourceKind }>>();

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

	const key = `${args.path}:${args.queryHash}`;
	const existing = inflightFetches.get(key) as Promise<{ body: T; source: SourceKind }> | undefined;
	if (existing) {
		// Another caller is already fetching this exact resource. Wait
		// for their result instead of issuing a duplicate upstream call.
		// We don't write the cache here — the originating caller does.
		const shared = await existing;
		return { body: shared.body, source: shared.source, fromCache: false };
	}

	const promise = withTimeout(fetcher(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS, args.scope);
	inflightFetches.set(key, promise as Promise<{ body: unknown; source: SourceKind }>);
	try {
		const fresh = await promise;
		await setCached(args.path, args.queryHash, fresh.body, fresh.source, args.ttlSec).catch((err) =>
			console.error(`[withCache:${args.scope}] cache set failed:`, err),
		);
		return { body: fresh.body, source: fresh.source, fromCache: false };
	} finally {
		inflightFetches.delete(key);
	}
}

export class UpstreamTimeoutError extends Error {
	readonly scope: string;
	readonly timeoutMs: number;
	/**
	 * Carried so the compute-jobs error mapper picks `upstream_timeout`
	 * instead of bucketing this into the generic `internal` 500 code.
	 * Callers (MCP, SDK) get an actionable code + can decide to retry or
	 * relax `minConfidence` / `lookbackDays` per the description.
	 */
	readonly code = "upstream_timeout" as const;
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
