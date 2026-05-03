/**
 * `client.disputes.*` — returns + cases + cancellations + inquiries
 * unified, with a `type` discriminator.
 */

import type {
	CancellationCreateRequest,
	CancellationCreateResponse,
	CancellationEligibilityRequest,
	CancellationEligibilityResponse,
	Dispute,
	DisputeActivityResponse,
	DisputeRespond,
	DisputesListQuery,
	DisputesListResponse,
	EvidenceAddRequest,
	EvidenceAddResponse,
	EvidenceFileUploadResponse,
	EvidenceUpdateRequest,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface DisputesClient {
	list(params?: DisputesListQuery): Promise<DisputesListResponse>;
	get(id: string): Promise<Dispute>;
	respond(id: string, body: DisputeRespond): Promise<Dispute>;
	activity(id: string): Promise<DisputeActivityResponse>;
	checkCancellation(body: CancellationEligibilityRequest): Promise<CancellationEligibilityResponse>;
	createCancellation(body: CancellationCreateRequest): Promise<CancellationCreateResponse>;
	uploadEvidenceFile(disputeId: string, file: Blob | File, filename?: string): Promise<EvidenceFileUploadResponse>;
	addEvidence(disputeId: string, body: EvidenceAddRequest): Promise<EvidenceAddResponse>;
	updateEvidence(disputeId: string, evidenceId: string, body: EvidenceUpdateRequest): Promise<void>;
	fetchEvidenceContent(disputeId: string, evidenceId: string, fileId: string): Promise<Response>;
}

export function createDisputesClient(http: FlipagentHttp): DisputesClient {
	return {
		list: (params) => http.get("/v1/disputes", params as Record<string, string | number | undefined> | undefined),
		get: (id) => http.get(`/v1/disputes/${encodeURIComponent(id)}`),
		respond: (id, body) => http.post(`/v1/disputes/${encodeURIComponent(id)}/respond`, body),
		activity: (id) => http.get(`/v1/disputes/${encodeURIComponent(id)}/activity`),
		checkCancellation: (body) => http.post("/v1/disputes/cancellations/check-eligibility", body),
		createCancellation: (body) => http.post("/v1/disputes/cancellations", body),
		uploadEvidenceFile: (disputeId, file, filename) => {
			const form = new FormData();
			form.append("file", file, filename);
			return http.postRaw(`/v1/disputes/${encodeURIComponent(disputeId)}/evidence/files`, form);
		},
		addEvidence: (disputeId, body) => http.post(`/v1/disputes/${encodeURIComponent(disputeId)}/evidence`, body),
		updateEvidence: (disputeId, evidenceId, body) =>
			http.put(`/v1/disputes/${encodeURIComponent(disputeId)}/evidence/${encodeURIComponent(evidenceId)}`, body),
		fetchEvidenceContent: (disputeId, evidenceId, fileId) =>
			http.fetchRaw(
				`/v1/disputes/${encodeURIComponent(disputeId)}/evidence/${encodeURIComponent(evidenceId)}/files/${encodeURIComponent(fileId)}`,
			),
	};
}
