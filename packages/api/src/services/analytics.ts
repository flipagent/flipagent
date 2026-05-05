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
import { EbayApiError, sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";

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
	// `traffic_report` is the only Sell Analytics endpoint that wants the
	// `yyyymmdd` date format (no hyphens) inside the filter expression.
	// Verified live 2026-05-03: `[2026-04-01..2026-04-08]` returns
	// errorId 50013 ("The start date range format is invalid. The format
	// is yyyymmdd."), `[20260401..20260408]` returns 200. The flipagent
	// surface accepts ISO dates; we strip hyphens at the wrapper boundary.
	const params = new URLSearchParams({
		filter:
			`marketplace_ids:{${ctx.marketplace ?? "EBAY_US"}},` +
			`date_range:[${from.replace(/-/g, "")}..${to.replace(/-/g, "")}]`,
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
	return { marketplace: "ebay_us", from, to, rows };
}

export async function getSellerStandards(
	cycle: "CURRENT" | "PROJECTED",
	ctx: AnalyticsContext,
): Promise<SellerStandards> {
	const programId = ctx.marketplace === "EBAY_GLOBAL" ? "PROGRAM_GLOBAL" : "PROGRAM_US";
	// Real eBay response shape (verified live 2026-05-03 against
	// sprd-shop's profile + spec at
	// `references/ebay-mcp/docs/_mirror/sell_analytics_v1_oas3.json`):
	// `{ standardsLevel, program, cycle: { cycleType }, evaluationReason,
	//    metrics: [{ name, value, level }], defaultProgram }`.
	// Previous wrapper destructured `evaluationLevel` and `evaluationCycle`
	// — neither exists. `level` was always falling back to "above_standard"
	// regardless of actual seller status.
	const res = await sellRequest<{
		standardsLevel?: string;
		program?: string;
		cycle?: { cycleType?: string };
		evaluationReason?: string;
		defaultProgram?: boolean;
		metrics?: Array<{ name: string; value?: number; level?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/analytics/v1/seller_standards_profile/${programId}/${cycle}`,
	}).catch(swallowEbay404);
	return {
		marketplace: "ebay_us",
		program: programId,
		cycle,
		level: LEVEL_FROM[res?.standardsLevel ?? "ABOVE_STANDARD"] ?? "above_standard",
		...(res?.cycle?.cycleType ? { evaluationCycle: res.cycle.cycleType } : {}),
		metrics: (res?.metrics ?? []).map((m) => ({
			name: m.name,
			...(m.value !== undefined ? { value: m.value } : {}),
			...(m.level ? { level: LEVEL_FROM[m.level] ?? "above_standard" } : {}),
		})),
	};
}

/**
 * eBay's published service-metric types. Each must be queried separately
 * via `/customer_service_metric/{type}/{evaluation_type}` — there is no
 * "list all" endpoint (the older `/customer_service_metric` bare path
 * returns errorId 2002 "Resource not found" — verified live 2026-05-03).
 * Spec source:
 * `references/ebay-mcp/docs/sell-apps/analytics-and-report/sell_analytics_v1_oas3.json`
 * lists `/customer_service_metric/{customer_service_metric_type}/{evaluation_type}`
 * as the only path.
 */
const SERVICE_METRIC_TYPES = ["ITEM_NOT_AS_DESCRIBED", "ITEM_NOT_RECEIVED"] as const;

export async function getServiceMetrics(ctx: AnalyticsContext): Promise<ServiceMetricsResponse> {
	const evaluationType = "CURRENT";
	const all: ServiceMetric[] = [];
	for (const t of SERVICE_METRIC_TYPES) {
		const res = await sellRequest<{
			metricKey?: string;
			cycle?: { cycleType?: string };
			metrics?: Array<{ name?: string; value?: number; level?: string }>;
			serviceMetrics?: Array<{ metricKey: string; level: string; count?: number; percentage?: number }>;
		}>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/analytics/v1/customer_service_metric/${t}/${evaluationType}`,
			marketplace: ctx.marketplace,
		}).catch((err: unknown) => {
			// errorId 54402 — "The specified marketplace ID is not a supported
			// marketplace." Customer service metrics are eBay-side limited to
			// EBAY_GB and EBAY_DE; US sellers get 54402. Treat as "no data
			// for this marketplace" rather than bubbling a 502 to the caller.
			if (err instanceof EbayApiError && err.status === 400) {
				const upstream = err.upstream as { errors?: Array<{ errorId?: number }> } | undefined;
				if (upstream?.errors?.[0]?.errorId === 54402) return undefined;
			}
			return swallowEbay404(err);
		});
		// eBay returns either a single record (with `metrics[]` per metric
		// row) or the legacy `serviceMetrics[]` shape — handle both.
		if (res?.serviceMetrics) {
			for (const m of res.serviceMetrics) {
				all.push({
					metric: m.metricKey,
					level: LEVEL_FROM[m.level] ?? "above_standard",
					count: m.count ?? 0,
					...(m.percentage !== undefined ? { percentage: m.percentage } : {}),
				});
			}
			continue;
		}
		for (const m of res?.metrics ?? []) {
			all.push({
				metric: m.name ?? t,
				level: LEVEL_FROM[m.level ?? "ABOVE_STANDARD"] ?? "above_standard",
				count: m.value ?? 0,
			});
		}
	}
	return { marketplace: "ebay_us", metrics: all };
}
