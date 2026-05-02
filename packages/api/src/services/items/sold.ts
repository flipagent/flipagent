/**
 * Sold-search composer. Mirrors `searchActiveListings` for
 * `/buy/marketplace_insights/v1_beta/item_sales/search`. All three
 * transports flow through here so cache + observation + pulse are
 * applied uniformly. 12-hour cache TTL — sold prices don't move
 * within a day.
 */

import type { BrowseSearchResponse, SoldSearchQuery } from "@flipagent/types/ebay/buy";
import { config, isEbayAppConfigured } from "../../config.js";
import type { ApiKey } from "../../db/schema.js";
import { scrapeSearch } from "../ebay/scrape/client.js";
import { recordSearchObservations } from "../observations.js";
import { hashQuery } from "../shared/cache.js";
import type { FlipagentResult } from "../shared/result.js";
import { selectTransport, TransportUnavailableError } from "../shared/transport.js";
import { timeoutMsForSource, withCache } from "../shared/with-cache.js";
import { recordQueryPulse } from "../trends.js";
import { bridgeSoldSearch } from "./bridge.js";
import { rethrowAsListingsError } from "./bridge-status.js";
import { ListingsError } from "./errors.js";
import { parseConditionIdsFilter } from "./filters.js";
import { fetchSoldSearchRest } from "./rest.js";
import type { ListingsSource } from "./search.js";

const SOLD_PATH = "/buy/marketplace_insights/v1_beta/item_sales/search";
const SOLD_TTL_SEC = 60 * 60 * 12;

export interface SoldSearchInput {
	q: string;
	limit?: number;
	/** Page offset. REST forwards via Marketplace Insights `offset=`; scrape converts to eBay's `_pgn`. */
	offset?: number;
	filter?: string;
	categoryIds?: string;
	conditionIds?: string[];
	/**
	 * eBay-spec optional params that Marketplace Insights supports
	 * (subset of Browse — no sort, auto_correct, compatibility_filter,
	 * or charity_ids on sold). REST + bridge forward verbatim; scrape
	 * silently ignores.
	 */
	aspectFilter?: string;
	gtin?: string;
	epid?: string;
	fieldgroups?: string;
}

export interface SoldSearchContext {
	/** Defaults to `config.EBAY_SOLD_SOURCE` when omitted. */
	source?: ListingsSource;
	apiKey?: ApiKey;
	marketplace?: string;
	acceptLanguage?: string;
}

export interface SoldSearchResult extends FlipagentResult<BrowseSearchResponse> {
	queryHash: string;
}

export async function searchSoldListings(
	input: SoldSearchInput,
	ctx: SoldSearchContext = {},
): Promise<SoldSearchResult> {
	// `selectTransport` consults the capability matrix — `listings.sold`
	// declares `rest.envFlag = "EBAY_INSIGHTS_APPROVED"` so REST is only
	// picked when the env flag is true AND eBay app creds are configured.
	// When either is missing, auto-pick returns `scrape`. An explicit
	// `?source=rest` in those cases surfaces as a 503.
	let source: ListingsSource;
	try {
		source = selectTransport("listings.sold", {
			explicit: ctx.source,
			envDefault: config.EBAY_SOLD_SOURCE,
			oauthBound: true,
			bridgePaired: !!ctx.apiKey,
			appCredsConfigured: isEbayAppConfigured(),
			envFlags: { EBAY_INSIGHTS_APPROVED: config.EBAY_INSIGHTS_APPROVED },
		}) as ListingsSource;
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			const code = err.message.includes("EBAY_INSIGHTS_APPROVED") ? "insights_not_approved" : "ebay_not_configured";
			throw new ListingsError(code, 503, err.message);
		}
		throw err;
	}

	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;
	const queryHash = hashQuery({
		q: input.q,
		filter: input.filter,
		limit,
		offset,
		soldOnly: true,
		categoryIds: input.categoryIds,
		aspectFilter: input.aspectFilter,
		gtin: input.gtin,
		epid: input.epid,
		fieldgroups: input.fieldgroups,
	});

	void recordQueryPulse({ keyword: input.q, categoryId: input.categoryIds });

	const result = await withCache(
		{
			scope: `listings:sold:${source}`,
			ttlSec: SOLD_TTL_SEC,
			path: SOLD_PATH,
			queryHash,
			timeoutMs: timeoutMsForSource(source),
		},
		async () => {
			const body = await dispatch(input, { ...ctx, source }, limit);
			void recordSearchObservations(body.itemSales ?? body.itemSummaries ?? [], { queryHash });
			return { body, source };
		},
	);
	return { ...result, queryHash };
}

async function dispatch(
	input: SoldSearchInput,
	ctx: { source: ListingsSource; apiKey?: ApiKey; marketplace?: string; acceptLanguage?: string },
	limit: number,
): Promise<BrowseSearchResponse> {
	if (ctx.source === "rest") {
		const query: SoldSearchQuery = {
			q: input.q,
			limit,
			...(input.offset != null && input.offset > 0 ? { offset: input.offset } : {}),
			...(input.filter ? { filter: input.filter } : {}),
			...(input.categoryIds ? { category_ids: input.categoryIds } : {}),
		};
		return fetchSoldSearchRest(query, { marketplace: ctx.marketplace, acceptLanguage: ctx.acceptLanguage });
	}
	if (ctx.source === "scrape") {
		try {
			// Same SRP-translatable subset as active. Sold-only fields like
			// `epid` / `fieldgroups` are silently dropped — no web-SRP
			// equivalent on the completed-listings page either.
			return await scrapeSearch({
				q: input.q,
				soldOnly: true,
				limit,
				offset: input.offset,
				conditionIds: input.conditionIds ?? parseConditionIdsFilter(input.filter),
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
	const bridgeQuery: SoldSearchQuery = {
		q: input.q,
		limit,
		...(input.offset != null && input.offset > 0 ? { offset: input.offset } : {}),
		...(input.filter ? { filter: input.filter } : {}),
		...(input.categoryIds ? { category_ids: input.categoryIds } : {}),
	};
	try {
		return await bridgeSoldSearch(ctx.apiKey, bridgeQuery);
	} catch (err) {
		rethrowAsListingsError(err);
	}
}
