import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";
import { mockSoldSearch } from "../mock.js";

export const ebaySoldSearchInput = Type.Object({
	q: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
	categoryId: Type.Optional(Type.String()),
});

export const ebaySoldSearchDescription =
	'Search recently-sold listings — the price-proof side of sourcing. Calls GET /v1/items/search?status=sold. **When to use** — sanity-check what a similar item *actually* sold for before quoting a buy/list price; complement to `flipagent_search_items` (which is active inventory only). For a full statistical comp set with same-product filtering, use `flipagent_evaluate_item` instead — this tool is the raw feed. **Inputs** — `q` free-text, optional `categoryId`, pagination `limit` (1–200, default 50) + `offset`. **Output** — `{ itemSales: Item[] }` with cents-int `soldPrice`, ISO `soldAt`, and `soldQuantity` per row. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — `{ q: "canon ef 50mm 1.8 stm", limit: 30 }`.';

export async function ebaySoldSearchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	if (config.mock) return mockSoldSearch();
	try {
		const client = getClient(config);
		return await client.items.search({
			status: "sold",
			q: args.q as string | undefined,
			limit: args.limit as number | undefined,
			offset: args.offset as number | undefined,
			categoryId: args.categoryId as string | undefined,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "items_search_sold_failed", "/v1/items/search");
	}
}
