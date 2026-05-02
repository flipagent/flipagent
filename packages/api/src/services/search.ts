/**
 * Search dispatcher — backs `/v1/items/search`. Mode-driven: "active"
 * routes to `searchActiveListings` (Browse), "sold" routes to
 * `searchSoldListings` (Marketplace Insights). Both already own cache
 * + transport selection + observation + demand pulse, so this file is
 * just a switch.
 *
 * Returns the underlying `FlipagentResult<BrowseSearchResponse>`
 * verbatim — `itemSummaries[]` for active mode, `itemSales[]` for
 * sold.
 */

import type { BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import type { ApiKey } from "../db/schema.js";
import type { ListingsSource } from "./items/search.js";
import { searchActiveListings } from "./items/search.js";
import { searchSoldListings } from "./items/sold.js";
import type { FlipagentResult } from "./shared/result.js";

export type SearchMode = "active" | "sold";

export interface SearchInput {
	q: string;
	mode?: SearchMode;
	limit?: number;
	/** Page offset. REST forwards via Marketplace Insights / Browse `offset=`; scrape converts to eBay's `_pgn`. Capped at offset+limit ≤ 10000 across both modes. */
	offset?: number;
	filter?: string;
	/** Honoured only when `mode === "active"`; sold ignores it (Marketplace Insights has no sort axis). */
	sort?: string;
	categoryIds?: string;
	/**
	 * eBay-spec optional params. Both modes honour `aspect_filter` /
	 * `gtin` / `epid` / `fieldgroups`; the rest (`auto_correct`,
	 * `compatibility_filter`, `charity_ids`) are active-only per eBay's
	 * Marketplace Insights spec — sold mode silently drops them.
	 */
	aspectFilter?: string;
	gtin?: string;
	epid?: string;
	fieldgroups?: string;
	autoCorrect?: string;
	compatibilityFilter?: string;
	charityIds?: string;
}

export interface SearchContext {
	source?: ListingsSource;
	apiKey?: ApiKey;
	marketplace?: string;
	acceptLanguage?: string;
}

export async function search(
	input: SearchInput,
	ctx: SearchContext = {},
): Promise<FlipagentResult<BrowseSearchResponse>> {
	const mode: SearchMode = input.mode ?? "active";
	if (mode === "sold") {
		return searchSoldListings(
			{
				q: input.q,
				limit: input.limit,
				offset: input.offset,
				filter: input.filter,
				categoryIds: input.categoryIds,
				aspectFilter: input.aspectFilter,
				gtin: input.gtin,
				epid: input.epid,
				fieldgroups: input.fieldgroups,
			},
			ctx,
		);
	}
	return searchActiveListings(
		{
			q: input.q,
			limit: input.limit,
			offset: input.offset,
			filter: input.filter,
			sort: input.sort,
			categoryIds: input.categoryIds,
			aspectFilter: input.aspectFilter,
			gtin: input.gtin,
			epid: input.epid,
			fieldgroups: input.fieldgroups,
			autoCorrect: input.autoCorrect,
			compatibilityFilter: input.compatibilityFilter,
			charityIds: input.charityIds,
		},
		ctx,
	);
}
