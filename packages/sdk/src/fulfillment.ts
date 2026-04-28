/**
 * `client.fulfillment.*` — orders to ship + tracking.
 */

import type { FlipagentHttp } from "./http.js";

export interface FulfillmentClient {
	listOrders(query?: Record<string, string | number>): Promise<unknown>;
	ship(orderId: string, body: unknown): Promise<unknown>;
}

export function createFulfillmentClient(http: FlipagentHttp): FulfillmentClient {
	return {
		listOrders: (query) => http.get("/v1/fulfillment/order", query),
		ship: (orderId, body) =>
			http.post(`/v1/fulfillment/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, body),
	};
}
