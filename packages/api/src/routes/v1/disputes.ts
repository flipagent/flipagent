/**
 * `/v1/disputes/*` — returns + cases + cancellations + inquiries
 * unified into one resource with a `type` discriminator.
 */

import {
	CancellationCreateRequest,
	CancellationCreateResponse,
	CancellationEligibilityRequest,
	CancellationEligibilityResponse,
	DisputeActivityResponse,
	DisputeRespond,
	DisputeResponse,
	DisputesListQuery,
	DisputesListResponse,
	EvidenceAddRequest,
	EvidenceAddResponse,
	EvidenceFileUploadResponse,
	EvidenceUpdateRequest,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { checkCancellationEligibility, createCancellation } from "../../services/disputes/cancellation.js";
import {
	addEvidence,
	fetchEvidenceContent,
	updateEvidence,
	uploadEvidenceFile,
} from "../../services/disputes/evidence.js";
import {
	closeInquiry,
	getDispute,
	getDisputeActivity,
	listDisputes,
	respondToDispute,
} from "../../services/disputes/operations.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const disputesRoute = new Hono();

const COMMON = { 401: errorResponse("Auth."), 502: errorResponse("Upstream eBay failed.") };

disputesRoute.get(
	"/",
	describeRoute({
		tags: ["Disputes"],
		summary: "List disputes (returns + cases + cancellations + inquiries)",
		parameters: paramsFor("query", DisputesListQuery),
		responses: { 200: jsonResponse("Disputes.", DisputesListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", DisputesListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listDisputes(q, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({
			disputes: r.disputes,
			limit: r.limit,
			offset: r.offset,
			source: "rest" as const,
		} satisfies DisputesListResponse);
	},
);

disputesRoute.get(
	"/:id",
	describeRoute({
		tags: ["Disputes"],
		summary: "Get a dispute (any type — auto-resolves by id)",
		responses: { 200: jsonResponse("Dispute.", DisputeResponse), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const dispute = await getDispute(c.req.param("id"), undefined, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!dispute) return c.json({ error: "dispute_not_found", message: "No dispute." }, 404);
		return c.json(dispute);
	},
);

disputesRoute.post(
	"/cancellations/check-eligibility",
	describeRoute({
		tags: ["Disputes"],
		summary: "Check if a seller can cancel an order",
		description:
			"Wraps `/post-order/v2/cancellation/check_eligibility`. Use before `flipagent_create_cancellation` to confirm cancellation is permitted (and surface eBay's allowed reason list). Some orders pass the cancellation window or are otherwise locked.",
		responses: {
			200: jsonResponse("Eligibility result.", CancellationEligibilityResponse),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(CancellationEligibilityRequest),
	async (c) => {
		const body = c.req.valid("json");
		const result = await checkCancellationEligibility(body.legacyOrderId, body.items, {
			apiKeyId: c.var.apiKey.id,
		});
		return c.json({ ...result, source: "rest" as const });
	},
);

disputesRoute.post(
	"/cancellations",
	describeRoute({
		tags: ["Disputes"],
		summary: "Create a seller-initiated cancellation",
		description:
			"Wraps `/post-order/v2/cancellation` (POST). For seller-initiated cancellations (out-of-stock, address issues, buyer asked). Distinct from `respondToDispute(action='accept')` which acknowledges a buyer-initiated cancellation request.",
		responses: {
			201: jsonResponse("Cancellation created.", CancellationCreateResponse),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(CancellationCreateRequest),
	async (c) => {
		const body = c.req.valid("json");
		const result = await createCancellation(body.legacyOrderId, body.reason, body.items, {
			apiKeyId: c.var.apiKey.id,
		});
		return c.json({ ...result, source: "rest" as const }, 201);
	},
);

disputesRoute.post(
	"/:id/close",
	describeRoute({
		tags: ["Disputes"],
		summary: "Close an open inquiry (no further action)",
		description:
			"Wraps `POST /post-order/v2/inquiry/{id}/close`. Inquiry-only; the call 404s for return / case / cancellation / payment dispute ids. Returns the refreshed Dispute (now `closed`).",
		responses: { 200: { description: "Closed." }, 404: errorResponse("Not an inquiry."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await closeInquiry(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "dispute_not_found" }, 404);
		return c.json({ ...r, source: "rest" as const });
	},
);

disputesRoute.get(
	"/:id/activity",
	describeRoute({
		tags: ["Disputes"],
		summary: "Activity history (payment disputes only)",
		description:
			"Returns the activity log for a payment dispute (open / contested / evidence-added / resolved). 404 when the id resolves to a return / case / cancellation / inquiry — eBay has no activity endpoint for those.",
		responses: {
			200: jsonResponse("Activity log.", DisputeActivityResponse),
			404: errorResponse("Dispute not found or not a payment dispute."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		const result = await getDisputeActivity(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!result) {
			return c.json(
				{
					error: "dispute_activity_unavailable",
					message: "Activity history is only available for payment disputes.",
				},
				404,
			);
		}
		return c.json({ ...result, source: "rest" as const });
	},
);

disputesRoute.post(
	"/:id/evidence/files",
	describeRoute({
		tags: ["Disputes"],
		summary: "Upload one binary evidence file (multipart) to a payment dispute",
		description:
			"Wraps `POST /sell/fulfillment/v1/payment_dispute/{id}/upload_evidence_file`. Accepts `multipart/form-data` with a `file` part (JPEG/JPG/PNG only per eBay). Returns the `fileId` you'll reference in `POST /v1/disputes/{id}/evidence` to bundle into an evidence set, then in `respondToDispute(action='decline')` to contest.",
		responses: {
			200: jsonResponse("File uploaded.", EvidenceFileUploadResponse),
			400: errorResponse("Missing file."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		const form = await c.req.parseBody();
		const file = form.file;
		if (!(file instanceof File)) {
			return c.json({ error: "missing_file", message: "POST a multipart form with a `file` part." }, 400);
		}
		const result = await uploadEvidenceFile({
			apiKeyId: c.var.apiKey.id,
			disputeId: c.req.param("id"),
			fileBuffer: await file.arrayBuffer(),
			contentType: file.type || "application/octet-stream",
			filename: file.name,
		});
		return c.json({ ...result, source: "rest" as const });
	},
);

disputesRoute.post(
	"/:id/evidence",
	describeRoute({
		tags: ["Disputes"],
		summary: "Bundle uploaded files into an evidence set on a payment dispute",
		description:
			"Wraps `POST /sell/fulfillment/v1/payment_dispute/{id}/add_evidence`. Pass `fileIds` from prior uploads + an `evidenceType` (eBay's EvidenceTypeEnum: PROOF_OF_DELIVERY, REPLACEMENT_SHIPPED, etc.). Returns the `evidenceId` for later updateEvidence + contest.",
		responses: {
			200: jsonResponse("Evidence created.", EvidenceAddResponse),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(EvidenceAddRequest),
	async (c) => {
		const body = c.req.valid("json");
		const result = await addEvidence({
			apiKeyId: c.var.apiKey.id,
			disputeId: c.req.param("id"),
			evidenceType: body.evidenceType,
			files: body.fileIds.map((fileId) => ({ fileId })),
			...(body.lineItems ? { lineItems: body.lineItems } : {}),
		});
		return c.json({ ...result, source: "rest" as const });
	},
);

disputesRoute.put(
	"/:id/evidence/:evidenceId",
	describeRoute({
		tags: ["Disputes"],
		summary: "Add more files to an existing evidence set",
		responses: { 204: { description: "Updated." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(EvidenceUpdateRequest),
	async (c) => {
		const body = c.req.valid("json");
		await updateEvidence({
			apiKeyId: c.var.apiKey.id,
			disputeId: c.req.param("id"),
			evidenceId: c.req.param("evidenceId"),
			evidenceType: body.evidenceType,
			files: body.fileIds.map((fileId) => ({ fileId })),
			...(body.lineItems ? { lineItems: body.lineItems } : {}),
		});
		return c.body(null, 204);
	},
);

disputesRoute.get(
	"/:id/evidence/:evidenceId/files/:fileId",
	describeRoute({
		tags: ["Disputes"],
		summary: "Download one evidence file (binary stream)",
		description:
			"Wraps `GET /sell/fulfillment/v1/payment_dispute/{id}/fetch_evidence_content`. Streams the raw file with eBay's Content-Type. Useful for audit / re-uploading to your own archive.",
		responses: { 200: { description: "Binary content." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const { data, contentType } = await fetchEvidenceContent({
			apiKeyId: c.var.apiKey.id,
			disputeId: c.req.param("id"),
			evidenceId: c.req.param("evidenceId"),
			fileId: c.req.param("fileId"),
		});
		return c.body(new Uint8Array(data), 200, { "Content-Type": contentType });
	},
);

disputesRoute.post(
	"/:id/respond",
	describeRoute({
		tags: ["Disputes"],
		summary: "Respond to a dispute",
		responses: {
			200: jsonResponse("Updated dispute.", DisputeResponse),
			404: errorResponse("Not found."),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(DisputeRespond),
	async (c) => {
		const dispute = await respondToDispute(c.req.param("id"), c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!dispute) return c.json({ error: "dispute_not_found", message: "No dispute." }, 404);
		return c.json(dispute);
	},
);
