/**
 * sell/compliance — listing violations + per-compliance-type summary.
 */

import type { Violation, ViolationSeverity, ViolationSummary, ViolationsListQuery } from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";

interface EbayViolation {
	listingId: string;
	sku?: string;
	complianceType?: string;
	complianceState?: string;
	violations?: Array<{
		violationId?: string;
		severity?: string;
		message?: string;
		title?: string;
		recommendation?: string;
		policyName?: string;
		violationCount?: number;
		respondBy?: string;
	}>;
}

const SEVERITY_MAP: Record<string, ViolationSeverity> = {
	INFO: "info",
	WARNING: "warning",
	CRITICAL: "critical",
	LISTING_BLOCKED: "listing_blocked",
};

function ebayViolationToFlipagent(row: EbayViolation): Violation[] {
	const out: Violation[] = [];
	for (const v of row.violations ?? []) {
		out.push({
			id: v.violationId ?? `${row.listingId}:${v.title ?? "violation"}`,
			marketplace: "ebay",
			listingId: row.listingId,
			...(row.sku ? { sku: row.sku } : {}),
			severity: SEVERITY_MAP[v.severity ?? "WARNING"] ?? "warning",
			complianceType: row.complianceType ?? "GENERIC",
			message: v.message ?? "",
			...(v.title ? { title: v.title } : {}),
			...(v.recommendation ? { recommendation: v.recommendation } : {}),
			...(v.policyName ? { policyName: v.policyName } : {}),
			...(v.violationCount !== undefined ? { violationCount: v.violationCount } : {}),
			...(row.complianceState ? { complianceState: row.complianceState } : {}),
			...(v.respondBy ? { respondBy: v.respondBy } : {}),
		});
	}
	return out;
}

export interface ViolationsContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function listViolations(
	q: ViolationsListQuery,
	ctx: ViolationsContext,
): Promise<{ violations: Violation[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.complianceType) params.set("compliance_type", q.complianceType);
	if (q.listingId) params.set("filter", `listingIds:{${q.listingId}}`);
	const res = await sellRequest<{ listingViolations?: EbayViolation[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/compliance/v1/listing_violation?${params.toString()}`,
		marketplace: ctx.marketplace,
	});
	const violations = (res?.listingViolations ?? []).flatMap(ebayViolationToFlipagent);
	return { violations, limit, offset, ...(res?.total !== undefined ? { total: res.total } : {}) };
}

interface EbaySummary {
	complianceType: string;
	listingCount: number;
	severity?: string;
}

export async function summarizeViolations(ctx: ViolationsContext): Promise<{ summaries: ViolationSummary[] }> {
	const res = await sellRequest<{ violationSummaries?: EbaySummary[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/compliance/v1/listing_violation_summary`,
		marketplace: ctx.marketplace,
	});
	const summaries = (res?.violationSummaries ?? []).map((s) => ({
		complianceType: s.complianceType,
		listingCount: s.listingCount,
		severity: SEVERITY_MAP[s.severity ?? "WARNING"] ?? "warning",
	}));
	return { summaries };
}
