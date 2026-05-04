/**
 * commerce/vero — Verified Rights Owner (VeRO) program. IP-rights
 * compliance reporting + reason-code reads. Used by sellers/agents
 * who need to report counterfeit listings or who appear in VeRO
 * reports themselves.
 *
 * Access: must be enrolled in eBay's VeRO Program. Without enrollment
 * eBay returns 403; flipagent returns the same.
 */

import { sellRequest, sellRequestWithLocation, swallowEbay404 } from "./ebay/rest/user-client.js";

export interface VeroContext {
	apiKeyId: string;
	marketplace?: string;
}

export interface VeroReasonCode {
	id: string;
	description?: string;
	marketplaceId?: string;
}

export interface VeroReportItem {
	itemId: string;
	reasonCodeId: string;
	reportedAt?: string;
	status?: string;
	resolution?: string;
}

export interface VeroReport {
	id: string;
	items: VeroReportItem[];
	createdAt?: string;
	status?: string;
}

interface UpstreamReasonCode {
	veroReasonCodeId?: string;
	description?: string;
	marketplaceId?: string;
}

interface UpstreamReport {
	veroReportId?: string;
	veroReportItems?: Array<{
		itemId?: string;
		veroReasonCodeId?: string;
		reportedAt?: string;
		status?: string;
		resolution?: string;
	}>;
	createdAt?: string;
	status?: string;
}

export async function listVeroReasonCodes(ctx: VeroContext): Promise<{ reasonCodes: VeroReasonCode[] }> {
	const res = await sellRequest<{ veroReasonCodes?: UpstreamReasonCode[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/vero/v1/vero_reason_code",
		marketplace: ctx.marketplace ?? "EBAY_US",
	}).catch(swallowEbay404);
	return {
		reasonCodes: (res?.veroReasonCodes ?? []).map((r) => ({
			id: r.veroReasonCodeId ?? "",
			...(r.description ? { description: r.description } : {}),
			...(r.marketplaceId ? { marketplaceId: r.marketplaceId } : {}),
		})),
	};
}

export async function getVeroReasonCode(id: string, ctx: VeroContext): Promise<VeroReasonCode | null> {
	const res = await sellRequest<UpstreamReasonCode>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/vero/v1/vero_reason_code/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace ?? "EBAY_US",
	}).catch(swallowEbay404);
	if (!res) return null;
	return {
		id: res.veroReasonCodeId ?? id,
		...(res.description ? { description: res.description } : {}),
		...(res.marketplaceId ? { marketplaceId: res.marketplaceId } : {}),
	};
}

export async function getVeroReport(id: string, ctx: VeroContext): Promise<VeroReport | null> {
	const res = await sellRequest<UpstreamReport>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/vero/v1/vero_report/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace ?? "EBAY_US",
	}).catch(swallowEbay404);
	if (!res) return null;
	return {
		id: res.veroReportId ?? id,
		items: (res.veroReportItems ?? []).map((it) => ({
			itemId: it.itemId ?? "",
			reasonCodeId: it.veroReasonCodeId ?? "",
			...(it.reportedAt ? { reportedAt: it.reportedAt } : {}),
			...(it.status ? { status: it.status } : {}),
			...(it.resolution ? { resolution: it.resolution } : {}),
		})),
		...(res.createdAt ? { createdAt: res.createdAt } : {}),
		...(res.status ? { status: res.status } : {}),
	};
}

export async function listVeroReportItems(ctx: VeroContext): Promise<{ items: VeroReportItem[] }> {
	const res = await sellRequest<{
		veroReportItems?: Array<{
			itemId?: string;
			veroReasonCodeId?: string;
			status?: string;
			resolution?: string;
			reportedAt?: string;
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/vero/v1/vero_report_items",
		marketplace: ctx.marketplace ?? "EBAY_US",
	}).catch(swallowEbay404);
	return {
		items: (res?.veroReportItems ?? []).map((it) => ({
			itemId: it.itemId ?? "",
			reasonCodeId: it.veroReasonCodeId ?? "",
			...(it.reportedAt ? { reportedAt: it.reportedAt } : {}),
			...(it.status ? { status: it.status } : {}),
			...(it.resolution ? { resolution: it.resolution } : {}),
		})),
	};
}

export async function createVeroReport(
	input: { items: Array<{ itemId: string; reasonCodeId: string; comments?: string; rightOwnerId?: string }> },
	ctx: VeroContext,
): Promise<{ id: string }> {
	const { body, locationId } = await sellRequestWithLocation<{ veroReportId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/commerce/vero/v1/vero_report",
		body: {
			veroReportItems: input.items.map((it) => ({
				itemId: it.itemId,
				veroReasonCodeId: it.reasonCodeId,
				...(it.comments ? { comments: it.comments } : {}),
				...(it.rightOwnerId ? { rightOwnerId: it.rightOwnerId } : {}),
			})),
		},
		marketplace: ctx.marketplace ?? "EBAY_US",
		contentLanguage: "en-US",
	});
	return { id: body?.veroReportId ?? locationId ?? "" };
}
