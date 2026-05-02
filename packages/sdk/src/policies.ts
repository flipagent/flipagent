/**
 * `client.policies.*` — selling policies (return | payment | fulfillment).
 */

import type { PoliciesListResponse, PolicyType } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface PoliciesClient {
	list(): Promise<PoliciesListResponse>;
	listByType(type: PolicyType): Promise<PoliciesListResponse>;
}

export function createPoliciesClient(http: FlipagentHttp): PoliciesClient {
	return {
		list: () => http.get("/v1/policies"),
		listByType: (type) => http.get(`/v1/policies/${type}`),
	};
}
