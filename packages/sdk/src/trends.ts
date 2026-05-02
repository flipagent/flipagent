/**
 * `client.trends.*` — cross-user demand trends. Hosted-only signals
 * (self-host instances can't compute these — no cross-user data).
 */

import type { FlipagentHttp } from "./http.js";

export interface TrendingCategory {
	categoryId: string;
	currentHourCount: number;
	weeklyBaselineHourly: number;
	zScore: number;
	asOf: string;
}

export interface TrendsCategoriesResponse {
	trending: TrendingCategory[];
}

export interface TrendsClient {
	categories(): Promise<TrendsCategoriesResponse>;
}

export function createTrendsClient(http: FlipagentHttp): TrendsClient {
	return {
		categories: () => http.get("/v1/trends/categories"),
	};
}
