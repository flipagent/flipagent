/**
 * `client.labels.*` — eBay-issued shipping labels (quote → buy → void).
 */

import type { Label, LabelPurchaseRequest, LabelQuoteRequest, LabelQuoteResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface LabelsClient {
	quote(body: LabelQuoteRequest): Promise<LabelQuoteResponse>;
	purchase(body: LabelPurchaseRequest): Promise<Label>;
	void(id: string): Promise<{ id: string; voided: boolean }>;
}

export function createLabelsClient(http: FlipagentHttp): LabelsClient {
	return {
		quote: (body) => http.post("/v1/labels/quote", body),
		purchase: (body) => http.post("/v1/labels", body),
		void: (id) => http.delete(`/v1/labels/${encodeURIComponent(id)}`),
	};
}
