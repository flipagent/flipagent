/**
 * `client.capabilities.get()` — agent's first call. Returns which
 * marketplaces / tools work right now for this api key. See
 * `@flipagent/types` `CapabilitiesResponse` for the full shape.
 */

import type { CapabilitiesResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface CapabilitiesClient {
	get(): Promise<CapabilitiesResponse>;
}

export function createCapabilitiesClient(http: FlipagentHttp): CapabilitiesClient {
	return {
		get: () => http.get<CapabilitiesResponse>("/v1/capabilities"),
	};
}
