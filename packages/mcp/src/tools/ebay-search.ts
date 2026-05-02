import { ItemSearchQuery } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { mockSearch } from "../mock.js";

export { ItemSearchQuery as ebaySearchInput };

export const ebaySearchDescription =
	"Search active marketplace listings (any seller). Calls GET /v1/items/search. Returns normalized `Item` records — cents-int Money, ISO timestamps, marketplace-tagged.";

export async function ebaySearchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	if (config.mock) return mockSearch();
	try {
		const client = getClient(config);
		return await client.items.search(args as unknown as Parameters<typeof client.items.search>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/items/search");
		return {
			error: "items_search_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: e.status === 401 ? "Set FLIPAGENT_API_KEY." : "Set FLIPAGENT_MCP_MOCK=1 to test without a backend.",
		};
	}
}
