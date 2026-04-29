import { DiscoverRequest as DiscoverDealsInputSchema, type DiscoverRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { DiscoverDealsInputSchema as discoverDealsInput };

export const discoverDealsDescription =
	"Rank deals across a Browse search response. Calls POST /v1/discover. Pass `results` (a BrowseSearchResponse with itemSummaries from /v1/buy/browse/item_summary/search, max 200 items) plus `opts.comparables`. Returns deals sorted by margin × confidence. One usage event regardless of how many items are scored.";

export async function discoverDealsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.discover.deals(args as unknown as DiscoverRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/discover");
		return { error: "discover_deals_failed", status: e.status, message: e.message, url: e.url };
	}
}
