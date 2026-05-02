/**
 * `client.items.*` — flipagent-native marketplace listings (read).
 * Wraps `/v1/items/*` with normalized cents-int Money + `Item` shape.
 *
 *   client.items.search({q, status, ...})
 *   client.items.get(id)
 */

import type { Item, ItemSearchQuery, ItemSearchResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ItemsClient {
	search(params: ItemSearchQuery): Promise<ItemSearchResponse>;
	get(id: string, opts?: { status?: "active" | "sold"; marketplace?: string }): Promise<Item & { source?: string }>;
}

export function createItemsClient(http: FlipagentHttp): ItemsClient {
	return {
		search: (params) => {
			const query: Record<string, string | number | undefined> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined) continue;
				if (Array.isArray(v)) query[k] = v.join(",");
				else if (typeof v === "object") continue;
				else query[k] = v as string | number;
			}
			return http.get("/v1/items/search", query);
		},
		get: (id, opts) =>
			http.get(`/v1/items/${encodeURIComponent(id)}`, {
				...(opts?.status ? { status: opts.status } : {}),
				...(opts?.marketplace ? { marketplace: opts.marketplace } : {}),
			}),
	};
}
