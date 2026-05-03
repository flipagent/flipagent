/**
 * sell/analytics — traffic + standards + service metrics.
 */

import type {
	SellerStandards,
	SellerStandardsLevel,
	ServiceMetric,
	ServiceMetricsResponse,
	TrafficReport,
	TrafficReportRow,
} from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";

const LEVEL_FROM: Record<string, SellerStandardsLevel> = {
	TOP_RATED: "top_rated",
	ABOVE_STANDARD: "above_standard",
	AT_RISK: "at_risk",
	BELOW_STANDARD: "below_standard",
};

export interface AnalyticsContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function getTrafficReport(
	from: string,
	to: string,
	dimension: string | undefined,
	ctx: AnalyticsContext,
): Promise<TrafficReport> {
	const params = new URLSearchParams({
		filter: `marketplace_ids:{${ctx.marketplace ?? "EBAY_US"}},date_range:[${from}..${to}]`,
	});
	if (dimension) params.set("dimension", dimension);
	const res = await sellRequest<{
		records?: Array<{
			dimensionValues?: Array<{ value: string }>;
			metricValues?: Array<{ value: string; metricKey: string }>;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/analytics/v1/traffic_report?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	const rows: TrafficReportRow[] = (res?.records ?? []).map((r) => {
		const m = new Map((r.metricValues ?? []).map((v) => [v.metricKey, Number(v.value)]));
		return {
			date: r.dimensionValues?.[0]?.value ?? "",
			...(m.has("LISTING_VIEWS_TOTAL") ? { listingViews: m.get("LISTING_VIEWS_TOTAL") } : {}),
			...(m.has("LISTING_IMPRESSION_TOTAL") ? { listingImpressions: m.get("LISTING_IMPRESSION_TOTAL") } : {}),
			...(m.has("CLICK_THROUGH_RATE") ? { clickThroughRate: m.get("CLICK_THROUGH_RATE") } : {}),
			...(m.has("TRANSACTION") ? { transactions: m.get("TRANSACTION") } : {}),
			...(m.has("SALES_CONVERSION_RATE") ? { salesConversionRate: m.get("SALES_CONVERSION_RATE") } : {}),
		};
	});
	return { marketplace: "ebay", from, to, rows };
}

export async function getSellerStandards(
	cycle: "CURRENT" | "PROJECTED",
	ctx: AnalyticsContext,
): Promise<SellerStandards> {
	const programId = ctx.marketplace === "EBAY_GLOBAL" ? "PROGRAM_GLOBAL" : "PROGRAM_US";
	const res = await sellRequest<{
		cycle?: { cycleType?: string };
		evaluationLevel?: string;
		evaluationCycle?: string;
		metrics?: Array<{ name: string; value?: number; level?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/analytics/v1/seller_standards_profile/${programId}/${cycle}`,
	}).catch(swallowEbay404);
	return {
		marketplace: "ebay",
		program: programId,
		cycle,
		level: LEVEL_FROM[res?.evaluationLevel ?? "ABOVE_STANDARD"] ?? "above_standard",
		...(res?.evaluationCycle ? { evaluationCycle: res.evaluationCycle } : {}),
		metrics: (res?.metrics ?? []).map((m) => ({
			name: m.name,
			...(m.value !== undefined ? { value: m.value } : {}),
			...(m.level ? { level: LEVEL_FROM[m.level] ?? "above_standard" } : {}),
		})),
	};
}

export async function getServiceMetrics(ctx: AnalyticsContext): Promise<ServiceMetricsResponse> {
	const res = await sellRequest<{
		serviceMetrics?: Array<{
			metricKey: string;
			level: string;
			count?: number;
			percentage?: number;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/analytics/v1/customer_service_metric",
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	const metrics: ServiceMetric[] = (res?.serviceMetrics ?? []).map((m) => ({
		metric: m.metricKey,
		level: LEVEL_FROM[m.level] ?? "above_standard",
		count: m.count ?? 0,
		...(m.percentage !== undefined ? { percentage: m.percentage } : {}),
	}));
	return { marketplace: "ebay", metrics };
}
