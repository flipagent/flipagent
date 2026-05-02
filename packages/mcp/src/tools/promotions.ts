/**
 * Promotion tools — coupon-style promotions on the seller's listings.
 * Backed by `/v1/promotions`. Reports are async — `create_report`
 * queues a task; poll with `get_report` until terminal.
 */

import { PromotionCreate, ReportTaskCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_promotions_list ----------------------- */

export const promotionsListInput = Type.Object({});

export const promotionsListDescription =
	"List active + scheduled promotions for the seller. GET /v1/promotions. Each row carries the rule (% off | $ off | order discount), eligible listings, and start/end timestamps.";

export async function promotionsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.promotions.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/promotions");
		return { error: "promotions_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_promotions_create ---------------------- */

export { PromotionCreate as promotionsCreateInput };

export const promotionsCreateDescription =
	"Create a promotion. POST /v1/promotions. Required: rule type, eligible listings, start/end. Use to launch a flash sale or move slow-moving stock.";

export async function promotionsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.promotions.create(args as Parameters<typeof client.promotions.create>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/promotions");
		return { error: "promotions_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_promotions_reports_list ------------------- */

export const promotionsReportsListInput = Type.Object({});
export const promotionsReportsListDescription =
	"List queued + completed promotion reports. GET /v1/promotions/reports.";
export async function promotionsReportsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.promotions.listReports();
	} catch (err) {
		const e = toApiCallError(err, "/v1/promotions/reports");
		return { error: "promotions_reports_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------- flipagent_promotions_reports_create ------------------ */

export { ReportTaskCreate as promotionsReportsCreateInput };
export const promotionsReportsCreateDescription =
	"Queue a promotion-performance report. POST /v1/promotions/reports. Returns a `ReportTask` with `id` — poll `flipagent_promotions_reports_get` until terminal.";
export async function promotionsReportsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.promotions.createReport(args as Parameters<typeof client.promotions.createReport>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/promotions/reports");
		return { error: "promotions_reports_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_promotions_reports_get -------------------- */

export const promotionsReportsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const promotionsReportsGetDescription =
	"Poll one promotion report task. GET /v1/promotions/reports/{id}. Terminal states: `succeeded`, `failed`.";
export async function promotionsReportsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.promotions.getReport(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/promotions/reports/${id}`);
		return { error: "promotions_reports_get_failed", status: e.status, url: e.url, message: e.message };
	}
}
