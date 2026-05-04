/**
 * `client.developer.*` — eBay developer self-service. Programmatic
 * registration of a new eBay app (sub-app, white-label tenant).
 */

import type { DeveloperAppRegisterRequest, DeveloperAppRegisterResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface DeveloperClient {
	register(body: DeveloperAppRegisterRequest): Promise<DeveloperAppRegisterResponse>;
}

export function createDeveloperClient(http: FlipagentHttp): DeveloperClient {
	return {
		register: (body) => http.post("/v1/developer/register", body),
	};
}
