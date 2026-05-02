/**
 * `client.promotions.*` — item promotions + summary report tasks.
 */

import type {
	PromotionCreate,
	PromotionsListResponse,
	ReportTask,
	ReportTaskCreate,
	ReportTasksListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface PromotionsClient {
	list(): Promise<PromotionsListResponse>;
	create(body: PromotionCreate): Promise<unknown>;
	listReports(): Promise<ReportTasksListResponse>;
	createReport(body: ReportTaskCreate): Promise<ReportTask>;
	getReport(id: string): Promise<ReportTask>;
}

export function createPromotionsClient(http: FlipagentHttp): PromotionsClient {
	return {
		list: () => http.get("/v1/promotions"),
		create: (body) => http.post("/v1/promotions", body),
		listReports: () => http.get("/v1/promotions/reports"),
		createReport: (body) => http.post("/v1/promotions/reports", body),
		getReport: (id) => http.get(`/v1/promotions/reports/${encodeURIComponent(id)}`),
	};
}
