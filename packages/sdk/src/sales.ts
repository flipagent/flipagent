/**
 * `client.sales.*` — orders I received (sell-side, fulfillment).
 */

import type { Sale, SaleRefundRequest, SaleShipRequest, SalesListQuery, SalesListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface SalesClient {
	list(params?: SalesListQuery): Promise<SalesListResponse>;
	get(id: string): Promise<Sale>;
	ship(id: string, body: SaleShipRequest): Promise<Sale>;
	refund(id: string, body: SaleRefundRequest): Promise<Sale>;
}

export function createSalesClient(http: FlipagentHttp): SalesClient {
	return {
		list: (params) => http.get("/v1/sales", params as Record<string, string | number | undefined> | undefined),
		get: (id) => http.get(`/v1/sales/${encodeURIComponent(id)}`),
		ship: (id, body) => http.post(`/v1/sales/${encodeURIComponent(id)}/ship`, body),
		refund: (id, body) => http.post(`/v1/sales/${encodeURIComponent(id)}/refund`, body),
	};
}
