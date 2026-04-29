/**
 * Shared response envelope for any flipagent service that fronts an
 * upstream (eBay REST, scraper, bridge, Trading XML, hosted LLM, …).
 *
 *   body       parsed JSON payload the route returns to the caller
 *   source     where the bytes ORIGINATED — always the upstream kind,
 *              never "cache:…" (cache hits keep the original source
 *              and flip `fromCache` true)
 *   fromCache  served from `proxy_response_cache` instead of a fresh
 *              upstream hit
 *   cachedAt   creation timestamp of the cached row (only when
 *              `fromCache` is true)
 *
 * Keeping `source` strictly as the data origin (and `fromCache` as a
 * separate boolean) means consumers can:
 *   - filter by origin without parsing prefixes
 *   - tell a stale cache hit from a fresh fetch in one field
 *   - safely union with a typed `SourceKind` without `cache:${string}`
 *     leaking into every type
 */

export type SourceKind = "rest" | "scrape" | "bridge" | "trading" | "llm";

export interface FlipagentResult<T> {
	body: T;
	source: SourceKind;
	fromCache: boolean;
	cachedAt?: Date;
}

/**
 * Coerce a free-form string from the cache `source` column to a
 * `SourceKind`. Legacy rows may carry scope-style values
 * ("taxonomy:default_id", "ebay-passthrough") from the previous
 * `cacheFirst` semantics; treat anything we don't recognise as
 * "rest" since every passthrough call hits eBay REST.
 */
export function coerceSourceKind(raw: string): SourceKind {
	switch (raw) {
		case "rest":
		case "scrape":
		case "bridge":
		case "trading":
		case "llm":
			return raw;
		default:
			return "rest";
	}
}
