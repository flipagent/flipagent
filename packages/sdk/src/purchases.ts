/**
 * `client.purchases.*` — items I've bought (buy-side, write).
 * Wraps `/v1/purchases/*`. One-shot create compresses eBay's
 * initiate + place_order; transport (REST/bridge) auto-picked.
 */

import type { Purchase, PurchaseCreate, PurchasesListQuery, PurchasesListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface PurchasesClient {
	create(body: PurchaseCreate): Promise<Purchase>;
	list(params?: PurchasesListQuery): Promise<PurchasesListResponse>;
	get(id: string): Promise<Purchase>;
	cancel(id: string): Promise<Purchase>;
}

export function createPurchasesClient(http: FlipagentHttp): PurchasesClient {
	return {
		create: (body) => http.post("/v1/purchases", body),
		list: (params) => http.get("/v1/purchases", params as Record<string, string | number | undefined> | undefined),
		get: (id) => http.get(`/v1/purchases/${encodeURIComponent(id)}`),
		cancel: (id) => http.post(`/v1/purchases/${encodeURIComponent(id)}/cancel`),
	};
}
