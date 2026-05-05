import { ItemSearchQuery } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";
import { mockSearch } from "../mock.js";
import { uiResource } from "../ui-resource.js";

export { ItemSearchQuery as ebaySearchInput };

export const ebaySearchDescription =
	'Search active marketplace listings (any seller). Calls GET /v1/items/search. **When to use** — sourcing radar: find candidate items by free-text query + filters. **Inputs** — `q` (free-text, required), optional filters: `priceMin`/`priceMax` (cents), `categoryId`, `conditionIds` (eBay condition ids, e.g. `["3000"]` for Used), `buyingOption` (`auction | fixed_price | best_offer`), `sort` (`price_asc | price_desc | newest | ending_soonest | relevance`), `marketplace` (default `ebay_us`), pagination `limit` (1–200, default 50) + `offset`. **Output** — `{ items: Item[], total, limit, offset, source }`. Each `Item.id` is the legacy eBay item id that feeds straight into `flipagent_get_item`, `flipagent_evaluate_item`, and `flipagent_create_purchase`. Hosts that support MCP Apps render an inline search-results panel; non-UI hosts see a JSON summary. **Prereqs** — `FLIPAGENT_API_KEY` set; anonymous app token is enough (no eBay OAuth needed). **Example** — `{ q: "canon ef 50mm 1.8", priceMax: 10000, buyingOption: "fixed_price" }`.';

export async function ebaySearchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	if (config.mock) return mockSearch();
	try {
		const client = getClient(config);
		const result = await client.items.search(args as unknown as Parameters<typeof client.items.search>[0]);
		const items = (result as { items?: unknown[] }).items ?? [];
		const total = (result as { total?: number }).total;
		const query = typeof args.q === "string" ? args.q : "";
		const summary =
			items.length === 0
				? `No active listings matched "${query}".`
				: `Found ${items.length}${total != null ? ` of ${total}` : ""} active listings for "${query}". Showing them inline; click any to evaluate.`;
		return uiResource({
			uri: "ui://flipagent/search-results",
			structuredContent: {
				query,
				items,
				total,
				source: (result as { source?: string }).source,
				args,
			},
			summary,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "search_items_failed", "/v1/items/search");
	}
}
