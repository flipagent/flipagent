/**
 * `client.violations.*` — sell/compliance violations.
 */

import type { ViolationsListQuery, ViolationsListResponse, ViolationsSummaryResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ViolationsClient {
	list(query?: ViolationsListQuery): Promise<ViolationsListResponse>;
	summary(): Promise<ViolationsSummaryResponse>;
}

export function createViolationsClient(http: FlipagentHttp): ViolationsClient {
	return {
		list: (query) => http.get("/v1/violations", query as Record<string, string | number | undefined> | undefined),
		summary: () => http.get("/v1/violations/summary"),
	};
}
