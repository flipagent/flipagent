/**
 * sell/marketing — async report tasks (ad reports + promotion summary
 * reports). Both kinds share the same task lifecycle (pending → running
 * → completed) and metadata shape; only the underlying eBay path differs.
 */

import type { ReportMetadata, ReportTask, ReportTaskCreate } from "@flipagent/types";
import { config, isEbayOAuthConfigured } from "../../config.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { getUserAccessToken } from "../ebay/oauth.js";
import { EbayApiError, sellRequest } from "../ebay/rest/user-client.js";
import type { MarketingContext } from "./promotions.js";

interface EbayReportTask {
	reportTaskId: string;
	status: string;
	reportStartDate?: string;
	reportEndDate?: string;
	reportName?: string;
	dimensions?: Array<{ dimensionKey: string }>;
	reportMetrics?: Array<{ metricKey: string }>;
	reportTaskCreationDate?: string;
	reportTaskCompletionDate?: string;
	reportHref?: string;
}

function taskFrom(t: EbayReportTask, kind: ReportTask["kind"]): ReportTask {
	const status =
		t.status === "RUNNING"
			? "running"
			: t.status === "COMPLETED" || t.status === "SUCCESS"
				? "completed"
				: t.status === "FAILED"
					? "failed"
					: "pending";
	return {
		id: t.reportTaskId,
		kind,
		status,
		...(t.reportStartDate ? { from: t.reportStartDate } : {}),
		...(t.reportEndDate ? { to: t.reportEndDate } : {}),
		...(t.reportHref ? { downloadUrl: t.reportHref } : {}),
		...(t.dimensions ? { dimensions: t.dimensions.map((d) => d.dimensionKey) } : {}),
		...(t.reportMetrics ? { metrics: t.reportMetrics.map((m) => m.metricKey) } : {}),
		createdAt: t.reportTaskCreationDate ?? "",
		...(t.reportTaskCompletionDate ? { completedAt: t.reportTaskCompletionDate } : {}),
	};
}

const REPORT_PATH: Record<ReportTask["kind"], string> = {
	ad: "/sell/marketing/v1/ad_report_task",
	promotion_summary: "/sell/marketing/v1/promotion_summary_report",
};

export async function listReportTasks(
	kind: ReportTask["kind"],
	ctx: MarketingContext,
): Promise<{ tasks: ReportTask[] }> {
	const res = await sellRequest<{ tasks?: EbayReportTask[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: REPORT_PATH[kind],
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return { tasks: (res?.tasks ?? []).map((t) => taskFrom(t, kind)) };
}

export async function getReportTask(
	id: string,
	kind: ReportTask["kind"],
	ctx: MarketingContext,
): Promise<ReportTask | null> {
	const res = await sellRequest<EbayReportTask>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${REPORT_PATH[kind]}/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return res ? taskFrom(res, kind) : null;
}

export async function createReportTask(input: ReportTaskCreate, ctx: MarketingContext): Promise<ReportTask> {
	const res = await sellRequest<{ reportTaskId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: REPORT_PATH[input.kind],
		body: {
			reportStartDate: input.from,
			reportEndDate: input.to,
			...(input.dimensions ? { dimensions: input.dimensions.map((d) => ({ dimensionKey: d })) } : {}),
			...(input.metrics ? { reportMetrics: input.metrics.map((m) => ({ metricKey: m })) } : {}),
		},
		marketplace: ctx.marketplace,
	});
	return {
		id: res?.reportTaskId ?? "",
		kind: input.kind,
		status: "pending",
		from: input.from,
		to: input.to,
		...(input.dimensions ? { dimensions: input.dimensions } : {}),
		...(input.metrics ? { metrics: input.metrics } : {}),
		createdAt: new Date().toISOString(),
	};
}

/**
 * Download a completed ad report as raw TSV. Wraps `GET /sell/
 * marketing/v1/ad_report/{report_id}`. The report itself is what
 * `getReportTask` returns the URL to once status='completed'; this
 * helper hits the URL directly and returns the bytes + content-type
 * (typically `text/tab-separated-values`).
 *
 * Per-user quota: 200 calls/hour (eBay-side limit).
 */
export async function downloadAdReport(
	reportId: string,
	ctx: MarketingContext,
): Promise<{ data: ArrayBuffer; contentType: string }> {
	if (!isEbayOAuthConfigured()) {
		throw new EbayApiError(503, "ebay_not_configured", "eBay OAuth credentials are not set on this api instance.");
	}
	const token = await getUserAccessToken(ctx.apiKeyId);
	const url = `${config.EBAY_BASE_URL}/sell/marketing/v1/ad_report/${encodeURIComponent(reportId)}`;
	const res = await fetchRetry(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		const text = await res.text();
		throw new EbayApiError(res.status, `ebay_${res.status}`, text || `eBay returned ${res.status}`);
	}
	return {
		data: await res.arrayBuffer(),
		contentType: res.headers.get("content-type") ?? "text/tab-separated-values",
	};
}

export async function getReportMetadata(ctx: MarketingContext): Promise<ReportMetadata> {
	const res = await sellRequest<{
		dimensions?: Array<{ dimensionKey: string; description?: string }>;
		metrics?: Array<{ metricKey: string; description?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/marketing/v1/ad_report_metadata",
		marketplace: ctx.marketplace,
	}).catch(() => null);
	return {
		dimensions: (res?.dimensions ?? []).map((d) => ({
			name: d.dimensionKey,
			...(d.description ? { description: d.description } : {}),
		})),
		metrics: (res?.metrics ?? []).map((m) => ({
			name: m.metricKey,
			...(m.description ? { description: m.description } : {}),
		})),
	};
}
