/**
 * `client.watching.*` — watch list (Trading XML AddToWatchList /
 * RemoveFromWatchList).
 */

import type { WatchAddRequest, WatchListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface WatchingClient {
	list(): Promise<WatchListResponse>;
	watch(body: WatchAddRequest): Promise<{ itemId: string; watching: true }>;
	unwatch(itemId: string): Promise<{ itemId: string; watching: false }>;
}

export function createWatchingClient(http: FlipagentHttp): WatchingClient {
	return {
		list: () => http.get("/v1/watching"),
		watch: (body) => http.post("/v1/watching", body),
		unwatch: (itemId) => http.delete(`/v1/watching/${encodeURIComponent(itemId)}`),
	};
}
