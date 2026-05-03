/**
 * Payment-dispute evidence — multipart binary upload + JSON evidence
 * sets + binary download. Completes the dispute response lifecycle
 * the contest/accept work started.
 *
 * Workflow:
 *   1. POST  /payment_dispute/{id}/upload_evidence_file (multipart) → {fileId}
 *   2. POST  /payment_dispute/{id}/add_evidence    {evidenceType, files: [{fileId}], lineItems?} → {evidenceId}
 *   3. POST  /payment_dispute/{id}/update_evidence {evidenceId, ...} (add more files later)
 *   4. POST  /payment_dispute/{id}/contest         (the previously-attached evidence is referenced automatically)
 *   5. GET   /payment_dispute/{id}/fetch_evidence_content?evidence_id=&file_id= (binary download for audit)
 *
 * Multipart upload bypasses `sellRequest` since that helper is JSON
 * only. Token resolution still goes through `getUserAccessToken` so
 * refresh + 401 mapping stays consistent.
 */

import { config, isEbayOAuthConfigured } from "../../config.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { getUserAccessToken } from "../ebay/oauth.js";
import { EbayApiError, sellRequest } from "../ebay/rest/user-client.js";

export interface EvidenceContext {
	apiKeyId: string;
}

export interface EvidenceFile {
	fileId: string;
}

export interface OrderLineItem {
	itemId: string;
	lineItemId: string;
}

async function ensureToken(apiKeyId: string): Promise<string> {
	if (!isEbayOAuthConfigured()) {
		throw new EbayApiError(503, "ebay_not_configured", "eBay OAuth credentials are not set on this api instance.");
	}
	try {
		return await getUserAccessToken(apiKeyId);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === "not_connected") {
			throw new EbayApiError(401, "ebay_account_not_connected", "Connect an eBay seller account first.");
		}
		throw new EbayApiError(502, "ebay_token_refresh_failed", `eBay token refresh failed: ${msg}`);
	}
}

export interface UploadEvidenceFileArgs {
	apiKeyId: string;
	disputeId: string;
	fileBuffer: ArrayBuffer | Blob;
	contentType: string;
	filename?: string;
}

export async function uploadEvidenceFile(args: UploadEvidenceFileArgs): Promise<{ fileId: string }> {
	const token = await ensureToken(args.apiKeyId);
	const blob =
		args.fileBuffer instanceof Blob ? args.fileBuffer : new Blob([args.fileBuffer], { type: args.contentType });
	const form = new FormData();
	form.append("file", blob, args.filename ?? "evidence.bin");
	const url = `${config.EBAY_BASE_URL}/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(args.disputeId)}/upload_evidence_file`;
	const res = await fetchRetry(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			// Do NOT set Content-Type — fetch derives the multipart boundary.
		},
		body: form,
	});
	const text = await res.text();
	if (!res.ok) {
		throw new EbayApiError(res.status, `ebay_${res.status}`, text || `eBay returned ${res.status}`);
	}
	const parsed = text ? (JSON.parse(text) as { fileId?: string }) : {};
	return { fileId: parsed.fileId ?? "" };
}

export interface AddEvidenceArgs {
	apiKeyId: string;
	disputeId: string;
	evidenceType: string;
	files: EvidenceFile[];
	lineItems?: OrderLineItem[];
}

export async function addEvidence(args: AddEvidenceArgs): Promise<{ evidenceId: string }> {
	const res = await sellRequest<{ evidenceId?: string }>({
		apiKeyId: args.apiKeyId,
		method: "POST",
		path: `/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(args.disputeId)}/add_evidence`,
		body: {
			evidenceType: args.evidenceType,
			files: args.files,
			...(args.lineItems ? { lineItems: args.lineItems } : {}),
		},
	});
	return { evidenceId: res?.evidenceId ?? "" };
}

export interface UpdateEvidenceArgs extends AddEvidenceArgs {
	evidenceId: string;
}

export async function updateEvidence(args: UpdateEvidenceArgs): Promise<{ ok: true }> {
	await sellRequest({
		apiKeyId: args.apiKeyId,
		method: "POST",
		path: `/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(args.disputeId)}/update_evidence`,
		body: {
			evidenceId: args.evidenceId,
			evidenceType: args.evidenceType,
			files: args.files,
			...(args.lineItems ? { lineItems: args.lineItems } : {}),
		},
	});
	return { ok: true };
}

export interface FetchEvidenceContentArgs {
	apiKeyId: string;
	disputeId: string;
	evidenceId: string;
	fileId: string;
}

export async function fetchEvidenceContent(args: FetchEvidenceContentArgs): Promise<{
	data: ArrayBuffer;
	contentType: string;
}> {
	const token = await ensureToken(args.apiKeyId);
	const params = new URLSearchParams({ evidence_id: args.evidenceId, file_id: args.fileId });
	const url = `${config.EBAY_BASE_URL}/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(args.disputeId)}/fetch_evidence_content?${params}`;
	const res = await fetchRetry(url, {
		method: "GET",
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		const text = await res.text();
		throw new EbayApiError(res.status, `ebay_${res.status}`, text || `eBay returned ${res.status}`);
	}
	return {
		data: await res.arrayBuffer(),
		contentType: res.headers.get("content-type") ?? "application/octet-stream",
	};
}
