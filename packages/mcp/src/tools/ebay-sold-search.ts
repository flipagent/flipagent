import { SoldSearchQuery } from "@flipagent/types/ebay/buy";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { mockSoldSearch } from "../mock.js";

export { SoldSearchQuery as ebaySoldSearchInput };

export const ebaySoldSearchDescription =
	"Search recently-sold eBay listings (Marketplace Insights data). Calls GET /v1/sold/search at api.flipagent.dev. Required for accurate price-history estimates.";

export async function ebaySoldSearchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	if (config.mock) return mockSoldSearch();
	try {
		const client = getClient(config);
		return await client.sold.search({
			q: args.q as string,
			filter: args.filter as string | undefined,
			limit: args.limit as number | undefined,
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/sold/search");
		return { error: "sold_search_failed", status: e.status, message: e.message, url: e.url };
	}
}
