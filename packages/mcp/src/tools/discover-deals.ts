import { DiscoverRequest as DiscoverDealsInputSchema, type DiscoverRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { DiscoverDealsInputSchema as discoverDealsInput };

export const discoverDealsDescription =
	'Find deals matching a query. Calls POST /v1/discover. Pass `q` (e.g. "charizard 1st edition"), optionally `categoryId` / `filter` (eBay Browse filter expression) / `limit` (max 200), plus `opts.minNetCents` / `opts.maxDaysToSell` decision floors. The server runs the full pipeline (active search → sold search → LLM same-product filter → batch score → rank). Returns `{ deals, meta }` — deals are filtered to positive-net only and sorted by recommendedExit.dollarsPerDay (capital efficiency = profit ÷ expected days to sell); meta carries the search trace (activeCount, soldCount, sources). One usage event per call.';

export async function discoverDealsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.discover.deals(args as unknown as DiscoverRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/discover");
		return { error: "discover_deals_failed", status: e.status, message: e.message, url: e.url };
	}
}
