/**
 * Passive capture intake — accepts a parsed eBay PDP from the Chrome
 * extension's content script and stores it in the shared response cache
 * so subsequent `/v1/items/*` lookups for the same item hit the cached
 * entry instead of issuing a fresh scrape.
 *
 * The extension parses the PDP via the same `parseEbayDetailHtml` shipped
 * in `@flipagent/ebay-scraper` (single source of truth — see
 * `packages/extension/src/content.ts`), so the wire payload here is the
 * canonical `EbayItemDetail` shape. We normalise it through the same
 * `ebayDetailToBrowse()` the bridge/scrape transports use, then write the
 * resulting `ItemDetail` into the cache keyed on `source: "scrape"` —
 * that's the cache key the default scrape transport reads, so any future
 * `getItemDetail()` call serves the captured copy without going to
 * Oxylabs.
 *
 * Privacy: caller URL is verified to be a public eBay PDP / search
 * (/itm/, /sch/, /p/) — never personal pages (/mye, /signin, /vod, etc.).
 * Rate-limited per api key (see `assertCaptureRate`) to prevent runaway
 * push from a misbehaving extension.
 */

import type { EbayItemDetail } from "@flipagent/ebay-scraper";
import type { ItemDetail } from "@flipagent/types/ebay";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ebayDetailToBrowse } from "./ebay/scrape/normalize.js";
import { DETAIL_PATH, DETAIL_TTL_SEC } from "./items/detail.js";
import { hashQuery, setCached } from "./shared/cache.js";

// Rate limit per api key. 60/min is well above any real browsing rate
// (a user opens ~1 PDP per few seconds at most) and below abuse thresholds.
const CAPTURE_RATE_PER_MIN = 60;

const ALLOWED_URL_PATTERNS = [
	/^https:\/\/(?:www\.)?ebay\.[a-z.]+\/itm\/\d+/i,
	/^https:\/\/(?:www\.)?ebay\.[a-z.]+\/p\/\d+/i,
	/^https:\/\/(?:www\.)?ebay\.[a-z.]+\/sch\//i,
];

const FORBIDDEN_URL_PATTERNS = [
	/\/mye\//i, // My eBay
	/\/myb\//i, // Buying activity
	/\/myb_summary/i, // Account summary
	/\/signin/i,
	/\/vod\//i, // Checkout / view-or-defer
	/\/chk\//i, // Checkout
	/\/sl\//i, // Sell flow
	/\/bsh\//i, // Seller hub
	/account\.ebay/i,
];

export type CaptureResult =
	| { stored: true; itemId: string; cachedFor: number }
	| { stored: false; reason: "invalid_url" | "private_url" | "parse_failed" | "no_item_id" };

export class CaptureRateLimitError extends Error {
	constructor() {
		super("rate limit exceeded");
		this.name = "CaptureRateLimitError";
	}
}

/**
 * Reject pushes that exceed the per-api-key cap. We count rows in the
 * captures audit table within the last 60s. Captures that succeeded
 * (stored=true) count; rejected URLs do NOT count (they're sanitization
 * misses, not abuse).
 *
 * Invoked BEFORE the actual write so a busy client gets a clean 429.
 */
export async function assertCaptureRate(apiKeyId: string): Promise<void> {
	const r = await db.execute<{ n: number }>(
		sql`select count(*)::int as n from bridge_captures
		    where api_key_id = ${apiKeyId} and captured_at > now() - interval '60 seconds'`,
	);
	const n = (r as { n: number }[])[0]?.n ?? 0;
	if (n >= CAPTURE_RATE_PER_MIN) throw new CaptureRateLimitError();
}

/**
 * Validate a captured URL against the allow/deny patterns. Returns
 * null when the URL is safe to ingest, or a reject reason otherwise.
 */
function classifyUrl(url: string): "invalid_url" | "private_url" | null {
	if (FORBIDDEN_URL_PATTERNS.some((re) => re.test(url))) return "private_url";
	if (!ALLOWED_URL_PATTERNS.some((re) => re.test(url))) return "invalid_url";
	return null;
}

/**
 * Normalise a captured `EbayItemDetail` (from the extension's parser)
 * into our `ItemDetail` wire shape and write it to the response cache.
 *
 * Returns the storage outcome. When `stored: true`, the next
 * `getItemDetail(legacyId)` call reads the captured copy from cache
 * without hitting Oxylabs/REST/bridge.
 */
export async function captureDetail(input: {
	apiKeyId: string;
	url: string;
	rawDetail: EbayItemDetail;
}): Promise<CaptureResult> {
	const reject = classifyUrl(input.url);
	if (reject) return { stored: false, reason: reject };

	const normalised: ItemDetail | null = ebayDetailToBrowse(input.rawDetail);
	if (!normalised) return { stored: false, reason: "parse_failed" };
	if (!normalised.legacyItemId) return { stored: false, reason: "no_item_id" };

	// Key captured detail under `source: "scrape"` so the default
	// detail-fetch path (which keys on `source` per `EBAY_DETAIL_SOURCE`)
	// finds it. Bridge/REST callers reading other source keys will still
	// fall through to their own transport — captured data benefits the
	// most-common path without leaking into transport-specific behaviour.
	//
	// Body is the bare ItemDetail (no envelope) — `withCache` stores
	// `body` and `source` as separate columns; double-wrapping would
	// surface to consumers as `result.body.body`.
	const queryHash = hashQuery({ itemId: normalised.legacyItemId, source: "scrape" });
	await setCached(DETAIL_PATH, queryHash, normalised, "capture", DETAIL_TTL_SEC);

	// Audit row: lets us later count captures per apiKey, prove provenance
	// for any individual cached entry, and enforce rate limits without
	// scanning the response cache itself.
	await db.execute(sql`insert into bridge_captures (api_key_id, item_id, url, captured_at)
		values (${input.apiKeyId}, ${normalised.legacyItemId}, ${input.url}, now())
		on conflict (api_key_id, item_id) do update set captured_at = now(), url = excluded.url`);

	return { stored: true, itemId: normalised.legacyItemId, cachedFor: DETAIL_TTL_SEC };
}
