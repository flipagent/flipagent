/**
 * post-order/v2 action helpers — every one-shot action eBay defines on
 * a return / inquiry / case / cancellation that isn't already covered
 * by the unified `respondToDispute` (return.decide, case.provide_seller_response,
 * cancellation.approve, inquiry.provide_seller_response). Each maps
 * directly to a `POST /post-order/v2/{type}/{id}/{action}` call with
 * an optional body. Centralizing here so callers don't reach into raw
 * `sellRequest`.
 *
 * Auth: post-order uses the legacy IAF token pipe (handled inside
 * `sellRequest` via the `/post-order/` path-prefix branch in
 * `services/ebay/rest/user-client.ts`).
 *
 * GET helpers also live here when they accompany an action (e.g.
 * `getReturnTracking`).
 */

import { sellRequest, swallowEbay404 } from "../ebay/rest/user-client.js";

export interface DisputeActionContext {
	apiKeyId: string;
	marketplace?: string;
}

/* ============================================================ inquiry */

export async function checkInquiryEligibility(
	legacyOrderId: string,
	ctx: DisputeActionContext,
): Promise<{ eligible: boolean; reason?: string }> {
	const res = await sellRequest<{ canCreateInquiry?: boolean; reason?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/inquiry/check_eligibility",
		body: { legacyOrderId },
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return { eligible: !!res?.canCreateInquiry, ...(res?.reason ? { reason: res.reason } : {}) };
}

export async function createInquiry(
	input: { legacyOrderId: string; reason: string; comments?: string },
	ctx: DisputeActionContext,
): Promise<{ inquiryId: string }> {
	const res = await sellRequest<{ inquiryId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/inquiry",
		body: input,
		marketplace: ctx.marketplace,
	});
	return { inquiryId: res?.inquiryId ?? "" };
}

export async function escalateInquiry(id: string, message: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/inquiry/${encodeURIComponent(id)}/escalate`,
		body: { comments: { content: message } },
		marketplace: ctx.marketplace,
	});
}

export async function inquiryIssueRefund(
	id: string,
	body: { refundAmount?: { value: string; currency: string }; comments?: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/inquiry/${encodeURIComponent(id)}/issue_refund`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function inquiryConfirmRefund(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/inquiry/${encodeURIComponent(id)}/confirm_refund`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function inquirySendMessage(id: string, message: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/inquiry/${encodeURIComponent(id)}/send_message`,
		body: { comments: { content: message } },
		marketplace: ctx.marketplace,
	});
}

export async function inquiryProvideShipmentInfo(
	id: string,
	body: { trackingNumber: string; carrier: string; comments?: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/inquiry/${encodeURIComponent(id)}/provide_shipment_info`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function inquiryProvideRefundInfo(
	id: string,
	body: { refundAmount?: { value: string; currency: string }; comments?: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/inquiry/${encodeURIComponent(id)}/provide_refund_info`,
		body,
		marketplace: ctx.marketplace,
	});
}

/* ============================================================ return */

export async function checkReturnEligibility(
	legacyOrderId: string,
	ctx: DisputeActionContext,
): Promise<{ eligible: boolean; reason?: string }> {
	const res = await sellRequest<{ canCreateReturn?: boolean; reason?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/return/check_eligibility",
		body: { legacyOrderId },
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return { eligible: !!res?.canCreateReturn, ...(res?.reason ? { reason: res.reason } : {}) };
}

export async function createReturn(
	input: { legacyOrderId: string; reason: string; comments?: string; itemCondition?: string },
	ctx: DisputeActionContext,
): Promise<{ returnId: string }> {
	const res = await sellRequest<{ returnId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/return",
		body: input,
		marketplace: ctx.marketplace,
	});
	return { returnId: res?.returnId ?? "" };
}

export async function cancelReturn(id: string, comments: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/cancel`,
		body: { comments: { content: comments } },
		marketplace: ctx.marketplace,
	});
}

export async function escalateReturn(id: string, message: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/escalate`,
		body: { comments: { content: message } },
		marketplace: ctx.marketplace,
	});
}

export async function returnIssueRefund(
	id: string,
	body: { refundAmount?: { value: string; currency: string }; comments?: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/issue_refund`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function returnMarkAsReceived(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/mark_as_received`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function returnMarkAsShipped(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/mark_as_shipped`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function returnSendMessage(id: string, message: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/send_message`,
		body: { comments: { content: message } },
		marketplace: ctx.marketplace,
	});
}

export async function getReturnTracking(id: string, ctx: DisputeActionContext): Promise<unknown | null> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/tracking`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
}

export async function updateReturnTracking(
	id: string,
	body: { trackingNumber: string; carrier: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/update_tracking`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function voidReturnShippingLabel(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/void_shipping_label`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

/* ============================================================ return shipping label flow */

/**
 * Return shipping-label flow. eBay treats the return label as a
 * separate resource with its own create / fetch / cancel / send /
 * tracking lifecycle. Seller-paid returns (`returnShippingCostPayer:
 * SELLER`) require this flow; buyer-paid returns skip it.
 */
export async function checkReturnLabelPrintEligibility(
	id: string,
	ctx: DisputeActionContext,
): Promise<{ eligible: boolean; reason?: string }> {
	const res = await sellRequest<{ eligible?: boolean; reason?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/check_label_print_eligibility`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return { eligible: !!res?.eligible, ...(res?.reason ? { reason: res.reason } : {}) };
}

export async function initiateReturnShippingLabel(
	id: string,
	ctx: DisputeActionContext,
): Promise<{ labelId?: string }> {
	const res = await sellRequest<{ labelId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/initiate_shipping_label`,
		body: {},
		marketplace: ctx.marketplace,
	});
	return res ?? {};
}

export async function getReturnShippingLabel(
	id: string,
	ctx: DisputeActionContext,
): Promise<{ labelUrl?: string; trackingNumber?: string; carrier?: string } | null> {
	return await sellRequest<{ labelUrl?: string; trackingNumber?: string; carrier?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/get_shipping_label`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
}

export async function addReturnShippingLabel(
	id: string,
	body: { labelDownloadUrl: string; trackingNumber: string; carrier: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/add_shipping_label`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function sendReturnShippingLabel(id: string, ctx: DisputeActionContext): Promise<void> {
	// Re-emails the buyer the return shipping label PDF.
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/send_shipping_label`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function listReturnFiles(
	id: string,
	ctx: DisputeActionContext,
): Promise<{ files: Array<{ fileId: string; name?: string; mimeType?: string }> }> {
	const res = await sellRequest<{ files?: Array<{ fileId: string; name?: string; mimeType?: string }> }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/files`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return { files: res?.files ?? [] };
}

export async function uploadReturnFile(
	id: string,
	body: { fileName: string; mimeType: string; data: string /* base64 */ },
	ctx: DisputeActionContext,
): Promise<{ fileId: string }> {
	const res = await sellRequest<{ fileId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/file/upload`,
		body,
		marketplace: ctx.marketplace,
	});
	return { fileId: res?.fileId ?? "" };
}

export async function submitReturnFile(
	id: string,
	body: { fileIds: string[]; comments?: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/file/submit`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function returnMarkRefundReceived(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/mark_refund_received`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function returnMarkRefundSent(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/return/${encodeURIComponent(id)}/mark_refund_sent`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function estimateReturn(
	body: { legacyOrderId: string; reason: string },
	ctx: DisputeActionContext,
): Promise<{ refundAmount?: { value: string; currency: string } } | null> {
	return await sellRequest<{ refundAmount?: { value: string; currency: string } }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/return/estimate",
		body,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
}

export async function getReturnPreference(
	ctx: DisputeActionContext,
): Promise<{ preferences?: Record<string, unknown> } | null> {
	return await sellRequest<{ preferences?: Record<string, unknown> }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/post-order/v2/return/preference",
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
}

export async function setReturnPreference(body: Record<string, unknown>, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/return/preference",
		body,
		marketplace: ctx.marketplace,
	});
}

/* ============================================================ casemanagement */

export async function closeCase(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/casemanagement/${encodeURIComponent(id)}/close`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function appealCase(id: string, message: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/casemanagement/${encodeURIComponent(id)}/appeal`,
		body: { comments: { content: message } },
		marketplace: ctx.marketplace,
	});
}

export async function caseIssueRefund(
	id: string,
	body: { refundAmount?: { value: string; currency: string }; comments?: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/casemanagement/${encodeURIComponent(id)}/issue_refund`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function caseProvideReturnAddress(
	id: string,
	body: { returnAddress: Record<string, string> },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/casemanagement/${encodeURIComponent(id)}/provide_return_address`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function caseProvideShipmentInfo(
	id: string,
	body: { trackingNumber: string; carrier: string },
	ctx: DisputeActionContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/casemanagement/${encodeURIComponent(id)}/provide_shipment_info`,
		body,
		marketplace: ctx.marketplace,
	});
}

/* ============================================================ cancellation */

export async function approveCancellation(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/cancellation/${encodeURIComponent(id)}/approve`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function confirmCancellation(id: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/cancellation/${encodeURIComponent(id)}/confirm`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function rejectCancellation(id: string, reason: string, ctx: DisputeActionContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/post-order/v2/cancellation/${encodeURIComponent(id)}/reject`,
		body: { reason },
		marketplace: ctx.marketplace,
	});
}
