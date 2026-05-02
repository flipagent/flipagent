/**
 * `client.takedown.*` — single pipe for removal requests
 * (DMCA / GDPR Art. 17 / CCPA / seller opt-out).
 */

import type { TakedownRequest, TakedownResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface TakedownClient {
	create(body: TakedownRequest): Promise<TakedownResponse>;
}

export function createTakedownClient(http: FlipagentHttp): TakedownClient {
	return {
		create: (body) => http.post("/v1/takedown", body),
	};
}
