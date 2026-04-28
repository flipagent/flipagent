import { ItemDetailParams } from "@flipagent/types/ebay/buy";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { mockItemDetail } from "../mock.js";

export { ItemDetailParams as ebayItemDetailInput };

export const ebayItemDetailDescription =
	"Fetch full detail for one eBay listing. Calls GET /v1/listings/{itemId} at api.flipagent.dev.";

export async function ebayItemDetailExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const itemId = String(args.itemId);
	if (config.mock) return mockItemDetail(itemId);
	try {
		const client = getClient(config);
		return await client.listings.get(itemId);
	} catch (err) {
		const e = toApiCallError(err, `/v1/listings/${itemId}`);
		return { error: "listings_get_failed", status: e.status, message: e.message, url: e.url };
	}
}
