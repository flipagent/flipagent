/**
 * `client.policies.*` — selling policies (return | payment | fulfillment).
 */

import type {
	PoliciesListResponse,
	PoliciesSetupRequest,
	PoliciesSetupResponse,
	Policy,
	PolicyType,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface PoliciesClient {
	list(): Promise<PoliciesListResponse>;
	byName(type: PolicyType, name: string): Promise<Policy>;
	setup(req: PoliciesSetupRequest): Promise<PoliciesSetupResponse>;
}

export function createPoliciesClient(http: FlipagentHttp): PoliciesClient {
	return {
		list: () => http.get("/v1/policies"),
		byName: (type, name) => http.get("/v1/policies/by-name", { type, name }),
		setup: (req) => http.post("/v1/policies/setup", req),
	};
}
