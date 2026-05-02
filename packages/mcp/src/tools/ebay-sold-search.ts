import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { mockSoldSearch } from "../mock.js";

export const ebaySoldSearchInput = Type.Object({
	q: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, default: 50 })),
	offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
	categoryId: Type.Optional(Type.String()),
});

export const ebaySoldSearchDescription =
	"Search recently-sold listings (price proof). Calls GET /v1/items/search?status=sold. Returns normalized `Item` records — cents-int Money, ISO `soldAt`/`soldPrice`/`soldQuantity`.";

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
		const e = toApiCallError(err, "/v1/items/search");
		return { error: "items_search_sold_failed", status: e.status, message: e.message, url: e.url };
	}
}
