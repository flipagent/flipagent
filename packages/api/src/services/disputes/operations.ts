/**
 * post-order/v2/{return|case|cancellation|inquiry} list/get/respond.
 *
 * Listing iterates whichever subset of types matches the query filter
 * (default: all four). Responding routes by the type discriminator.
 */

import type { Dispute, DisputeRespond, DisputesListQuery, DisputeType } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";
import {
	type EbayCancellationRecord,
	type EbayCaseRecord,
	type EbayInquiryRecord,
	type EbayReturnRecord,
	ebayCancellationToDispute,
	ebayCaseToDispute,
	ebayInquiryToDispute,
	ebayReturnToDispute,
} from "./transform.js";

const ALL_TYPES: readonly DisputeType[] = ["return", "case", "cancellation", "inquiry", "payment"];

const PATH: Record<DisputeType, string> = {
	return: "/post-order/v2/return/search",
	case: "/post-order/v2/casemanagement/search",
	cancellation: "/post-order/v2/cancellation/search",
	inquiry: "/post-order/v2/inquiry/search",
	payment: "/sell/fulfillment/v1/payment_dispute/search",
};

const GET_PATH: Record<DisputeType, (id: string) => string> = {
	return: (id) => `/post-order/v2/return/${encodeURIComponent(id)}`,
	case: (id) => `/post-order/v2/casemanagement/${encodeURIComponent(id)}`,
	cancellation: (id) => `/post-order/v2/cancellation/${encodeURIComponent(id)}`,
	inquiry: (id) => `/post-order/v2/inquiry/${encodeURIComponent(id)}`,
	payment: (id) => `/sell/fulfillment/v1/payment_dispute/${encodeURIComponent(id)}`,
};

export interface DisputesContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function listDisputes(
	q: DisputesListQuery,
	ctx: DisputesContext,
): Promise<{ disputes: Dispute[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const types = q.type ? [q.type] : ALL_TYPES;
	const all: Dispute[] = [];
	for (const t of types) {
		const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
		if (q.orderId) params.set("order_id", q.orderId);
		const path = `${PATH[t]}?${params.toString()}`;
		const res = await sellRequest<Record<string, unknown>>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path,
			marketplace: ctx.marketplace,
		}).catch(() => null);
		if (!res) continue;
		if (t === "return") {
			const rows = (res.members ?? res.returns ?? []) as EbayReturnRecord[];
			all.push(...rows.map((r) => ebayReturnToDispute(r, q.marketplace)));
		} else if (t === "case") {
			const rows = (res.members ?? res.cases ?? []) as EbayCaseRecord[];
			all.push(...rows.map((r) => ebayCaseToDispute(r, q.marketplace)));
		} else if (t === "cancellation") {
			const rows = (res.members ?? res.cancellations ?? []) as EbayCancellationRecord[];
			all.push(...rows.map((r) => ebayCancellationToDispute(r, q.marketplace)));
		} else {
			const rows = (res.members ?? res.inquiries ?? []) as EbayInquiryRecord[];
			all.push(...rows.map((r) => ebayInquiryToDispute(r, q.marketplace)));
		}
	}
	const filtered = q.status ? all.filter((d) => d.status === q.status) : all;
	return { disputes: filtered, limit, offset };
}

export async function getDispute(
	id: string,
	type: DisputeType | undefined,
	ctx: DisputesContext,
): Promise<Dispute | null> {
	const types = type ? [type] : ALL_TYPES;
	for (const t of types) {
		const res = await sellRequest<Record<string, unknown>>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: GET_PATH[t](id),
			marketplace: ctx.marketplace,
		}).catch(() => null);
		if (!res) continue;
		if (t === "return") return ebayReturnToDispute(res as unknown as EbayReturnRecord);
		if (t === "case") return ebayCaseToDispute(res as unknown as EbayCaseRecord);
		if (t === "cancellation") return ebayCancellationToDispute(res as unknown as EbayCancellationRecord);
		return ebayInquiryToDispute(res as unknown as EbayInquiryRecord);
	}
	return null;
}

const RESPOND_PATH: Record<DisputeType, string> = {
	return: "decide",
	case: "provide_seller_response",
	cancellation: "approve",
	inquiry: "provide_seller_response",
	payment: "contest",
};

export async function respondToDispute(
	id: string,
	body: DisputeRespond,
	ctx: DisputesContext,
): Promise<Dispute | null> {
	const current = await getDispute(id, undefined, ctx);
	if (!current) return null;
	const action = body.action.toUpperCase();
	const requestBody: Record<string, unknown> = { decisionType: action };
	if (body.amount) {
		requestBody.refundAmount = { value: (body.amount.value / 100).toFixed(2), currency: body.amount.currency };
	}
	if (body.trackingNumber) requestBody.trackingNumber = body.trackingNumber;
	if (body.carrier) requestBody.shippingCarrier = body.carrier;
	if (body.message) requestBody.comments = body.message;
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${GET_PATH[current.type](id)}/${RESPOND_PATH[current.type]}`,
		body: requestBody,
		marketplace: ctx.marketplace,
	});
	return getDispute(id, current.type, ctx);
}
