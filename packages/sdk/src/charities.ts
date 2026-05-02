/**
 * `client.charities.*` — eBay for Charity organizations.
 */

import type { CharitiesListQuery, CharitiesListResponse, Charity } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface CharitiesClient {
	list(query?: CharitiesListQuery): Promise<CharitiesListResponse>;
	get(id: string): Promise<Charity>;
}

export function createCharitiesClient(http: FlipagentHttp): CharitiesClient {
	return {
		list: (query) => http.get("/v1/charities", query as Record<string, string | number | undefined> | undefined),
		get: (id) => http.get(`/v1/charities/${encodeURIComponent(id)}`),
	};
}
