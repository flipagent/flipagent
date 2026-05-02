/**
 * Active-listings search composer. Single source of truth for the
 * `cache → record pulse → dispatch by source → cache write + observe`
 * pipeline behind `/v1/items/search`.
 *
 * All three transports (rest / scrape / bridge) flow through here so
 * route handlers stay thin (input → call → headers) and any callers
 * outside the route inherit the same cache + observation hooks for
 * free.
 *
 * Pulse fires every call (cache hit included) so warm caches don't
 * mute the demand signal. Observation writes only fire on a fresh
 * fetch — re-archiving the same listing on every cache hit would
 * explode the table without adding signal.
 */

import type { BrowseSearchQuery, BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { config, isEbayAppConfigured } from "../../config.js";
import type { ApiKey } from "../../db/schema.js";
import { type ScrapeSearchInput, scrapeSearch } from "../../services/ebay/scrape/client.js";
import { hashQuery } from "../../services/shared/cache.js";
import { recordSearchObservations } from "../observations.js";
import type { FlipagentResult } from "../shared/result.js";
import { selectTransport, TransportUnavailableError } from "../shared/transport.js";
import { timeoutMsForSource, withCache } from "../shared/with-cache.js";
import { recordQueryPulse } from "../trends.js";
import { bridgeListingsSearch } from "./bridge.js";
import { rethrowAsListingsError } from "./bridge-status.js";
import { ListingsError } from "./errors.js";
import { filterIncludesAuctionOnly, filterIncludesBinOnly, parseConditionIdsFilter } from "./filters.js";
import { fetchActiveSearchRest } from "./rest.js";

const ACTIVE_PATH = "/buy/browse/v1/item_summary/search";

const SCRAPE_SORT_MAP: Record<string, ScrapeSearchInput["sort"]> = {
	endingSoonest: "endingSoonest",
	newlyListed: "newlyListed",
	"price asc": "pricePlusShippingLowest",
	"price desc": "pricePlusShippingHighest",
};

export type ListingsSource = "rest" | "scrape" | "bridge";

export interface ActiveSearchInput {
	/**
	 * Keyword query. Optional — when omitted (or empty), the call must
	 * carry `categoryIds`/`gtin`/`epid` (eBay's "at least one" rule).
	 * Empty `q` + `categoryIds` triggers the category-only browse path
	 * (REST `/buy/browse/v1/item_summary/search?category_ids=`,
	 * bridge mirrors REST, scrape resolves to `/b/_/<categoryId>`).
	 */
	q?: string;
	limit?: number;
	/**
	 * Page offset — REST passthrough only (eBay Browse caps practical
	 * pagination at offset+limit ≤ 10000). Scrape source ignores it
	 * (the search-page parser only reads page 1); bridge mirrors REST.
	 */
	offset?: number;
	filter?: string;
	sort?: string;
	categoryIds?: string;
	/**
	 * Numeric Browse condition ids (`["1000","3000"]`). When set, the
	 * scrape source forwards them as `LH_ItemCondition`. The REST and
	 * bridge sources expect them folded into `filter` (eBay syntax:
	 * `conditionIds:{1000|3000}`); pass them via `filter` for those.
	 */
	conditionIds?: string[];
	/**
	 * eBay-spec optional params. Forwarded verbatim to REST and bridge.
	 * Scrape silently ignores them — eBay's web SRP doesn't expose
	 * equivalents for most (aspect_filter, fieldgroups, etc.); agents
	 * needing exact mirror semantics must use REST.
	 */
	aspectFilter?: string;
	gtin?: string;
	epid?: string;
	fieldgroups?: string;
	autoCorrect?: string;
	compatibilityFilter?: string;
	charityIds?: string;
}

export interface ActiveSearchContext {
	/** Defaults to `config.EBAY_LISTINGS_SOURCE` when omitted. */
	source?: ListingsSource;
	/** Required when the resolved source is `'bridge'`. */
	apiKey?: ApiKey;
	marketplace?: string;
	acceptLanguage?: string;
}

/**
 * Listings search returns the shared `FlipagentResult` envelope plus
 * the `queryHash` it computed — callers (cache invalidation, dev
 * tooling, observation linking) reach for that key directly.
 */
export interface ActiveSearchResult extends FlipagentResult<BrowseSearchResponse> {
	queryHash: string;
}

const ACTIVE_TTL_SEC = 60 * 60; // 60 min — shared with proxy default

export async function searchActiveListings(
	input: ActiveSearchInput,
	ctx: ActiveSearchContext = {},
): Promise<ActiveSearchResult> {
	// Resolve transport via the central capability matrix. `ctx.source`
	// is the explicit caller choice; env default (`EBAY_LISTINGS_SOURCE`)
	// is the fallback. When eBay app creds aren't configured, REST is
	// unreachable — auto falls through to scrape. Explicit `?source=rest`
	// while unconfigured surfaces as a 503.
	//
	// Special case for category-only browse (no keyword, just a
	// `categoryIds`): scrape is preferred over REST regardless of env
	// default. This is the high-volume Sourcing-UI first-impression path
	// and we'd rather burn Oxylabs $/req than the REST 5000/day quota,
	// which is shared with every OAuth-bound op (listings, sales, etc.).
	// Explicit `ctx.source` still wins.
	const isCategoryOnlyBrowse = (!input.q || !input.q.trim()) && !!input.categoryIds;
	const envDefault = isCategoryOnlyBrowse && !ctx.source ? "scrape" : config.EBAY_LISTINGS_SOURCE;
	let source: ListingsSource;
	try {
		source = selectTransport("listings.search", {
			explicit: ctx.source,
			envDefault,
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
	const resolved: Required<Pick<ActiveSearchContext, "source">> & ActiveSearchContext = { ...ctx, source };
	const limit = input.limit ?? 25;
	const offset = input.offset ?? 0;
	// All inputs that vary the upstream URL go into the queryHash so
	// distinct param sets get distinct cache entries. Otherwise an
	// aspect-filtered search would alias against the unfiltered one.
	const queryHash = hashQuery({
		q: input.q,
		filter: input.filter,
		sort: input.sort,
		limit,
		offset,
		soldOnly: false,
		categoryIds: input.categoryIds,
		aspectFilter: input.aspectFilter,
		gtin: input.gtin,
		epid: input.epid,
		fieldgroups: input.fieldgroups,
		autoCorrect: input.autoCorrect,
		compatibilityFilter: input.compatibilityFilter,
		charityIds: input.charityIds,
	});

	// Pulse fires every call (warm cache hits included) so the demand
	// signal isn't muted by the cache layer.
	void recordQueryPulse({ keyword: input.q ?? "", categoryId: input.categoryIds });

	const result = await withCache(
		{
			scope: `listings:active:${source}`,
			ttlSec: ACTIVE_TTL_SEC,
			path: ACTIVE_PATH,
			queryHash,
			timeoutMs: timeoutMsForSource(source),
		},
		async () => {
			const body = await dispatch(input, resolved, limit);
			// Observation writes only on a fresh fetch — re-archiving on
			// every cache hit explodes the table without adding signal.
			void recordSearchObservations(body.itemSummaries ?? body.itemSales ?? [], { queryHash });
			return { body, source };
		},
	);
	return { ...result, queryHash };
}

async function dispatch(
	input: ActiveSearchInput,
	ctx: { source: ListingsSource; apiKey?: ApiKey; marketplace?: string; acceptLanguage?: string },
	limit: number,
): Promise<BrowseSearchResponse> {
	if (ctx.source === "rest") {
		const query: BrowseSearchQuery = {
			...(input.q?.trim() ? { q: input.q } : {}),
			limit,
			...(input.offset != null && input.offset > 0 ? { offset: input.offset } : {}),
			...(input.filter ? { filter: input.filter } : {}),
			...(input.sort ? { sort: input.sort } : {}),
			...(input.categoryIds ? { category_ids: input.categoryIds } : {}),
			...(input.aspectFilter ? { aspect_filter: input.aspectFilter } : {}),
			...(input.gtin ? { gtin: input.gtin } : {}),
			...(input.epid ? { epid: input.epid } : {}),
			...(input.fieldgroups ? { fieldgroups: input.fieldgroups } : {}),
			...(input.autoCorrect ? { auto_correct: input.autoCorrect } : {}),
			...(input.compatibilityFilter ? { compatibility_filter: input.compatibilityFilter } : {}),
			...(input.charityIds ? { charity_ids: input.charityIds } : {}),
		};
		return fetchActiveSearchRest(query, { marketplace: ctx.marketplace, acceptLanguage: ctx.acceptLanguage });
	}
	if (ctx.source === "scrape") {
		try {
			// Forward what eBay's web SRP can express; silently drop the
			// rest (epid / fieldgroups / auto_correct / compatibility_filter
			// / charity_ids — no SRP equivalents). Agents needing exact
			// mirror semantics use the REST source.
			return await scrapeSearch({
				q: input.q,
				auctionOnly: filterIncludesAuctionOnly(input.filter),
				binOnly: filterIncludesBinOnly(input.filter),
				conditionIds: input.conditionIds ?? parseConditionIdsFilter(input.filter),
				sort: input.sort ? SCRAPE_SORT_MAP[input.sort] : undefined,
				limit,
				offset: input.offset,
				categoryIds: input.categoryIds,
				aspectFilter: input.aspectFilter,
				gtin: input.gtin,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new ListingsError("upstream_failed", 502, msg);
		}
	}
	// bridge
	if (!ctx.apiKey) {
		throw new ListingsError("bridge_failed", 500, "bridge source requires apiKey in context");
	}
	const bridgeQuery: BrowseSearchQuery = {
		...(input.q?.trim() ? { q: input.q } : {}),
		limit,
		...(input.offset != null && input.offset > 0 ? { offset: input.offset } : {}),
		...(input.filter ? { filter: input.filter } : {}),
		...(input.sort ? { sort: input.sort } : {}),
		...(input.categoryIds ? { category_ids: input.categoryIds } : {}),
		...(input.aspectFilter ? { aspect_filter: input.aspectFilter } : {}),
		...(input.gtin ? { gtin: input.gtin } : {}),
		...(input.epid ? { epid: input.epid } : {}),
		...(input.fieldgroups ? { fieldgroups: input.fieldgroups } : {}),
		...(input.autoCorrect ? { auto_correct: input.autoCorrect } : {}),
		...(input.compatibilityFilter ? { compatibility_filter: input.compatibilityFilter } : {}),
		...(input.charityIds ? { charity_ids: input.charityIds } : {}),
	};
	try {
		return await bridgeListingsSearch(ctx.apiKey, bridgeQuery);
	} catch (err) {
		rethrowAsListingsError(err);
	}
}
