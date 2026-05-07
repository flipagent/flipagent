/**
 * `POST /v1/items/search-by-image` — image-based item search.
 *
 * Wraps eBay Buy Browse `search_by_image` (app credential + POST,
 * unlike keyword search which is GET). Body carries a base64-encoded
 * image; response shape is the same `ItemSearchResponse` as keyword
 * search, normalized through the shared `ebayItemToFlipagent` mapper.
 *
 * No transport selection — image search is REST-only on eBay's side.
 */

import type { Item, ItemSearchByImageRequest, ItemSearchResponse } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { appRequest } from "../ebay/rest/app-client.js";
import { ebayMarketplaceId } from "../shared/marketplace.js";
import { ebayItemToFlipagent } from "./transform.js";

interface EbaySearchByImageResponse {
	itemSummaries?: ItemSummary[];
	total?: number;
	limit?: number;
	offset?: number;
}

export async function searchItemsByImage(input: ItemSearchByImageRequest): Promise<ItemSearchResponse> {
	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	const res = await appRequest<EbaySearchByImageResponse>({
		method: "POST",
		path: `/buy/browse/v1/item_summary/search_by_image?${params.toString()}`,
		body: { image: input.image },
		marketplace: ebayMarketplaceId(input.marketplace),
	});
	const items: Item[] = (res?.itemSummaries ?? []).map((s) => ebayItemToFlipagent(s));
	return {
		items,
		limit: res?.limit ?? limit,
		offset: res?.offset ?? offset,
		...(res?.total !== undefined ? { total: res.total } : {}),
	};
}
