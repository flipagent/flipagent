/**
 * `client.analytics.*` — seller traffic, standards, customer-service metrics.
 */

import type { SellerStandards, ServiceMetricsResponse, TrafficReport } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface AnalyticsClient {
	traffic(opts?: { from?: string; to?: string }): Promise<TrafficReport>;
	standards(): Promise<SellerStandards>;
	serviceMetrics(): Promise<ServiceMetricsResponse>;
}

export function createAnalyticsClient(http: FlipagentHttp): AnalyticsClient {
	return {
		traffic: (opts) =>
			http.get("/v1/analytics/traffic", {
				...(opts?.from ? { from: opts.from } : {}),
				...(opts?.to ? { to: opts.to } : {}),
			}),
		standards: () => http.get("/v1/analytics/standards"),
		serviceMetrics: () => http.get("/v1/analytics/service-metrics"),
	};
}
