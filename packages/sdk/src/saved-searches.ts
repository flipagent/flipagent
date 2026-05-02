/**
 * `client.savedSearches.*` — saved searches (Trading XML).
 */

import type { SavedSearch, SavedSearchCreate, SavedSearchesListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface SavedSearchesClient {
	list(): Promise<SavedSearchesListResponse>;
	create(body: SavedSearchCreate): Promise<SavedSearch>;
	delete(id: string): Promise<{ id: string; deleted: boolean }>;
}

export function createSavedSearchesClient(http: FlipagentHttp): SavedSearchesClient {
	return {
		list: () => http.get("/v1/saved-searches"),
		create: (body) => http.post("/v1/saved-searches", body),
		delete: (id) => http.delete(`/v1/saved-searches/${encodeURIComponent(id)}`),
	};
}
