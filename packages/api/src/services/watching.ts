/**
 * `/v1/watching/*` — watch list (Trading XML AddToWatchList /
 * RemoveFromWatchList / GetMyeBayBuying for the read).
 */

import type { WatchEntry, WatchListResponse } from "@flipagent/types";
import { addToWatchList, getMyEbayBuying, removeFromWatchList } from "./ebay/trading/myebay.js";
import { rowToItem } from "./me-overview.js";

export async function fetchWatchList(accessToken: string): Promise<WatchListResponse> {
	const r = await getMyEbayBuying(accessToken);
	const items: WatchEntry[] = r.watching.items.map((row) => rowToItem(row) as WatchEntry);
	return { items, total: r.watching.total };
}

export async function watchItem(accessToken: string, itemId: string): Promise<{ added: boolean }> {
	return addToWatchList(accessToken, itemId);
}

export async function unwatchItem(accessToken: string, itemId: string): Promise<{ removed: boolean }> {
	return removeFromWatchList(accessToken, itemId);
}
