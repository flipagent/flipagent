/**
 * `client.recommendations.*` — listing optimization recommendations.
 */

import type { RecommendationsListQuery, RecommendationsListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface RecommendationsClient {
	list(query?: RecommendationsListQuery): Promise<RecommendationsListResponse>;
}

export function createRecommendationsClient(http: FlipagentHttp): RecommendationsClient {
	return {
		list: (query) =>
			http.get("/v1/recommendations", query as Record<string, string | number | undefined> | undefined),
	};
}
