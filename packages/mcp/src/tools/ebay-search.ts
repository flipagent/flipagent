import { BrowseSearchQuery } from "@flipagent/types/ebay/buy";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { mockSearch } from "../mock.js";

export { BrowseSearchQuery as ebaySearchInput };

export const ebaySearchDescription =
	"Search active eBay listings via the unified flipagent surface. Calls GET /v1/listings/search at api.flipagent.dev. Returns the standard SearchPagedCollection envelope (eBay-shape).";

export async function ebaySearchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	if (config.mock) return mockSearch();
	try {
		const client = getClient(config);
		return await client.listings.search({
			q: args.q as string,
			filter: args.filter as string | undefined,
			sort: args.sort as string | undefined,
			limit: args.limit as number | undefined,
			offset: args.offset as number | undefined,
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/listings/search");
		return {
			error: "listings_search_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: e.status === 401 ? "Set FLIPAGENT_API_KEY." : "Set FLIPAGENT_MCP_MOCK=1 to test without a backend.",
		};
	}
}
