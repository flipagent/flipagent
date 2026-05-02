/**
 * `client.listingGroups.*` — multi-variation parent groups.
 */

import type { ListingGroup, ListingGroupUpsert } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ListingGroupsClient {
	upsert(id: string, body: ListingGroupUpsert): Promise<ListingGroup>;
	get(id: string): Promise<ListingGroup>;
	delete(id: string): Promise<{ id: string; deleted: boolean }>;
}

export function createListingGroupsClient(http: FlipagentHttp): ListingGroupsClient {
	return {
		upsert: (id, body) => http.put(`/v1/listing-groups/${encodeURIComponent(id)}`, body),
		get: (id) => http.get(`/v1/listing-groups/${encodeURIComponent(id)}`),
		delete: (id) => http.delete(`/v1/listing-groups/${encodeURIComponent(id)}`),
	};
}
