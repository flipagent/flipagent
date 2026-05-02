/**
 * `client.disputes.*` — returns + cases + cancellations + inquiries
 * unified, with a `type` discriminator.
 */

import type {
	Dispute,
	DisputeActivityResponse,
	DisputeRespond,
	DisputesListQuery,
	DisputesListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface DisputesClient {
	list(params?: DisputesListQuery): Promise<DisputesListResponse>;
	get(id: string): Promise<Dispute>;
	respond(id: string, body: DisputeRespond): Promise<Dispute>;
	activity(id: string): Promise<DisputeActivityResponse>;
}

export function createDisputesClient(http: FlipagentHttp): DisputesClient {
	return {
		list: (params) => http.get("/v1/disputes", params as Record<string, string | number | undefined> | undefined),
		get: (id) => http.get(`/v1/disputes/${encodeURIComponent(id)}`),
		respond: (id, body) => http.post(`/v1/disputes/${encodeURIComponent(id)}/respond`, body),
		activity: (id) => http.get(`/v1/disputes/${encodeURIComponent(id)}/activity`),
	};
}
