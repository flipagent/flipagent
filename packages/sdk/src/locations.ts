/**
 * `client.locations.*` — seller fulfillment locations (warehouse / store).
 * eBay calls these "merchant locations"; we use `id` for the eBay-side
 * `merchantLocationKey`.
 */

import type { Location, LocationCreate, LocationsListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface LocationsClient {
	list(): Promise<LocationsListResponse>;
	get(id: string): Promise<Location>;
	upsert(id: string, body: LocationCreate): Promise<Location>;
	delete(id: string): Promise<{ deleted: boolean }>;
	enable(id: string): Promise<Location>;
	disable(id: string): Promise<Location>;
}

export function createLocationsClient(http: FlipagentHttp): LocationsClient {
	return {
		list: () => http.get("/v1/locations"),
		get: (id) => http.get(`/v1/locations/${encodeURIComponent(id)}`),
		upsert: (id, body) => http.put(`/v1/locations/${encodeURIComponent(id)}`, body),
		delete: (id) => http.delete(`/v1/locations/${encodeURIComponent(id)}`),
		enable: (id) => http.post(`/v1/locations/${encodeURIComponent(id)}/enable`, undefined),
		disable: (id) => http.post(`/v1/locations/${encodeURIComponent(id)}/disable`, undefined),
	};
}
