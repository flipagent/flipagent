/**
 * Item-detail composer. Mirrors the search/sold composers for
 * `/buy/browse/v1/item/{itemId}`. Cache → dispatch by source → cache
 * write + observation hook. 4h cache TTL — detail pages don't change
 * often.
 *
 * Returns null when neither the cache nor the chosen transport
 * surfaced a body (typically scrape returning null on a missing
 * listing). Callers translate that into a 404.
 */

import type { ItemDetail } from "@flipagent/types/ebay/buy";
import { config, isEbayAppConfigured } from "../../config.js";
import type { ApiKey } from "../../db/schema.js";
import { toLegacyId } from "../../utils/item-id.js";
import { scrapeItemDetail } from "../ebay/scrape/client.js";
import { recordDetailObservation } from "../observations.js";
import { hashQuery } from "../shared/cache.js";
import type { FlipagentResult } from "../shared/result.js";
import { selectTransport, TransportUnavailableError } from "../shared/transport.js";
import { timeoutMsForSource, withCache } from "../shared/with-cache.js";
import { bridgeItemDetail } from "./bridge.js";
import { rethrowAsListingsError } from "./bridge-status.js";
import { ListingsError } from "./errors.js";
import { fetchItemDetailRest } from "./rest.js";
import type { ListingsSource } from "./search.js";

export const DETAIL_PATH = "/buy/browse/v1/item";
export const DETAIL_TTL_SEC = 60 * 60 * 4;

export interface DetailContext {
	/** Defaults to `config.EBAY_DETAIL_SOURCE` when omitted. */
	source?: ListingsSource;
	apiKey?: ApiKey;
	marketplace?: string;
	acceptLanguage?: string;
	/**
	 * eBay variation id for multi-SKU listings (sneakers / clothes / bags).
	 * When present, REST passes `legacy_variation_id`, scrape appends
	 * `?var=`, bridge navigates to the variation URL — so the resulting
	 * detail's price + per-SKU aspects reflect that specific variation
	 * instead of eBay's default-rendered one. Cache key includes the
	 * variation so different SKUs get distinct entries.
	 */
	variationId?: string;
}

export type DetailResult = FlipagentResult<ItemDetail>;

/**
 * Fetch detail for a numeric legacy itemId via the configured source.
 * Returns null when the listing wasn't found (scrape returned null,
 * etc.). Throws `ListingsError` on transport failure.
 */
export async function getItemDetail(legacyId: string, ctx: DetailContext = {}): Promise<DetailResult | null> {
	let source: ListingsSource;
	try {
		source = selectTransport("listings.detail", {
			explicit: ctx.source,
			envDefault: config.EBAY_DETAIL_SOURCE,
			oauthBound: true,
			bridgePaired: !!ctx.apiKey,
			appCredsConfigured: isEbayAppConfigured(),
		}) as ListingsSource;
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			throw new ListingsError("ebay_not_configured", 503, err.message);
		}
		throw err;
	}
	// `variationId` factors into the cache key so different SKUs of the
	// same parent listing get distinct entries — otherwise the first
	// variation requested would poison the cache for every subsequent
	// variation lookup of that legacy id. `source` is folded in too:
	// `withCache` keys on path+queryHash only (the `scope` arg is for
	// telemetry, not key composition), so without this, flipping
	// `EBAY_DETAIL_SOURCE` between scrape/REST/bridge serves a stale
	// entry from whichever source filled the cache first — which in
	// turn loses fields each transport carries differently (REST has
	// `qualifiedPrograms` / `authenticityGuarantee`, scrape has
	// `variations`, etc.).
	const queryHash = hashQuery({
		itemId: legacyId,
		...(ctx.variationId ? { variationId: ctx.variationId } : {}),
		source,
	});

	// `withCache` wraps cache-or-fetch; the fetcher returns null when
	// the listing 404s upstream so we surface that as a missing item.
	let missing = false;
	const result = await withCache(
		{
			scope: `listings:detail:${source}`,
			ttlSec: DETAIL_TTL_SEC,
			path: DETAIL_PATH,
			queryHash,
			timeoutMs: timeoutMsForSource(source),
		},
		async () => {
			const body = await dispatch(legacyId, { ...ctx, source });
			if (!body) {
				missing = true;
				// Throw a sentinel so withCache skips the cache write; the
				// catch below converts it to a null return.
				throw new MissingDetail();
			}
			void recordDetailObservation(body, { queryHash });
			return { body, source };
		},
	).catch((err) => {
		if (err instanceof MissingDetail) return null;
		throw err;
	});
	if (missing || !result) return null;
	return result;
}

class MissingDetail extends Error {
	constructor() {
		super("missing_detail");
	}
}

/**
 * Resolve any caller-provided id form (v1|<n>|0 or bare numeric) and
 * delegate to `getItemDetail`. Used by services that hold an
 * ItemSummary and want detail without hand-rolling the id parse.
 */
export async function getItemDetailFromSummary(
	item: { legacyItemId?: string | null; itemId?: string | null },
	ctx: DetailContext = {},
): Promise<DetailResult | null> {
	const legacyId = toLegacyId(item);
	if (!legacyId) return null;
	return getItemDetail(legacyId, ctx);
}

/**
 * Build a closure that fetches an `ItemSummary`'s full detail — bound
 * to one `apiKey` (so per-tier auth + quota are honoured) and stripped
 * of the `FlipagentResult` envelope the consumer doesn't need.
 * Structurally matches the matcher's `DetailFetcher` port so callers
 * pass it straight through without a type import:
 *
 *   const fetchDetail = detailFetcherFor(apiKey);
 *   await matchPool(seed, pool, opts, fetchDetail);
 *
 * Each fetch goes through the standard withCache 4h → Oxylabs
 * semaphore → retry path.
 */
export function detailFetcherFor(apiKey?: ApiKey) {
	return async (item: { legacyItemId?: string | null; itemId?: string | null }): Promise<ItemDetail | null> => {
		const r = await getItemDetailFromSummary(item, { apiKey });
		return r?.body ?? null;
	};
}

async function dispatch(
	legacyId: string,
	ctx: {
		source: ListingsSource;
		apiKey?: ApiKey;
		marketplace?: string;
		acceptLanguage?: string;
		variationId?: string;
	},
): Promise<ItemDetail | null> {
	if (ctx.source === "rest") {
		try {
			return await fetchItemDetailRest(legacyId, {
				marketplace: ctx.marketplace,
				acceptLanguage: ctx.acceptLanguage,
				variationId: ctx.variationId,
			});
		} catch (err) {
			if (err instanceof ListingsError && err.status === 404) return null;
			throw err;
		}
	}
	if (ctx.source === "scrape") {
		try {
			return await scrapeItemDetail(legacyId, ctx.variationId);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new ListingsError("upstream_failed", 502, msg);
		}
	}
	// bridge
	if (!ctx.apiKey) {
		throw new ListingsError("bridge_failed", 500, "bridge source requires apiKey in context");
	}
	try {
		return await bridgeItemDetail(ctx.apiKey, legacyId, ctx.variationId);
	} catch (err) {
		rethrowAsListingsError(err);
	}
}
