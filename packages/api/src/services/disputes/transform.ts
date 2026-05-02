/**
 * post-order/v2/{return,case,cancellation,inquiry} → flipagent Dispute.
 *
 * eBay returns 4 different shapes for what flipagent considers one
 * "dispute" resource. Each carries a different status enum + field
 * subset. We unify into a `type`-discriminated row.
 */

import type { Dispute, DisputeStatus, DisputeType, Marketplace } from "@flipagent/types";
import { moneyFrom } from "../shared/money.js";

interface EbayMoney {
	value: string;
	currencyCode?: string;
	currency?: string;
}
interface EbayReturnRecord {
	returnId: string;
	creationDate?: string;
	lastModifiedDate?: string;
	itemId?: string;
	orderId?: string;
	state?: string;
	status?: string;
	buyerLoginName?: string;
	reason?: string;
	totalAmount?: EbayMoney;
	sellerResponseDueDate?: string;
}
interface EbayCaseRecord {
	caseId: string;
	creationDate?: string;
	lastModifiedDate?: string;
	itemId?: string;
	orderId?: string;
	caseStatus?: string;
	buyerLoginName?: string;
	reasonForOpening?: string;
	totalAmount?: EbayMoney;
	sellerResponseDueDate?: string;
	closedDate?: string;
}
interface EbayCancellationRecord {
	cancelId: string;
	creationDate?: string;
	lastModifiedDate?: string;
	orderId?: string;
	cancelState?: string;
	cancelStatus?: string;
	buyerLoginName?: string;
	cancelReason?: string;
	cancelClosedDate?: string;
}
interface EbayInquiryRecord {
	inquiryId: string;
	creationDate?: string;
	lastModifiedDate?: string;
	itemId?: string;
	orderId?: string;
	inquiryStatus?: string;
	buyerLoginName?: string;
	itemNotReceivedReason?: string;
	totalAmount?: EbayMoney;
	sellerResponseDueDate?: string;
	closedDate?: string;
}

function returnStatus(state: string | undefined): DisputeStatus {
	const s = (state ?? "").toUpperCase();
	if (s.includes("CLOSED")) return "closed";
	if (s.includes("ESCALATED")) return "escalated";
	if (s.includes("WAITING_FOR_SELLER") || s.includes("PENDING_SELLER")) return "seller_action_required";
	if (s.includes("WAITING_FOR_BUYER") || s.includes("PENDING_BUYER")) return "buyer_action_required";
	if (s.includes("RESOLVED") || s.includes("REFUNDED")) return "resolved";
	return "open";
}

function caseStatus(s: string | undefined): DisputeStatus {
	const u = (s ?? "").toUpperCase();
	if (u === "CLOSED") return "closed";
	if (u === "ESCALATED") return "escalated";
	if (u.includes("SELLER")) return "seller_action_required";
	if (u.includes("BUYER")) return "buyer_action_required";
	if (u === "RESOLVED") return "resolved";
	return "open";
}

function cancellationStatus(s: string | undefined): DisputeStatus {
	const u = (s ?? "").toUpperCase();
	if (u === "CLOSED" || u === "COMPLETED") return "closed";
	if (u === "DECLINED" || u === "REJECTED") return "resolved";
	if (u.includes("SELLER")) return "seller_action_required";
	return "open";
}

export function ebayReturnToDispute(r: EbayReturnRecord, marketplace: Marketplace = "ebay"): Dispute {
	return {
		id: r.returnId,
		marketplace,
		type: "return",
		status: returnStatus(r.state ?? r.status),
		orderId: r.orderId ?? "",
		...(r.buyerLoginName ? { buyer: r.buyerLoginName } : {}),
		...(r.reason ? { reason: r.reason } : {}),
		...(r.totalAmount ? { amount: moneyFrom(r.totalAmount) } : {}),
		...(r.sellerResponseDueDate ? { respondBy: r.sellerResponseDueDate } : {}),
		createdAt: r.creationDate ?? "",
		...(r.lastModifiedDate ? { updatedAt: r.lastModifiedDate } : {}),
	};
}

export function ebayCaseToDispute(c: EbayCaseRecord, marketplace: Marketplace = "ebay"): Dispute {
	return {
		id: c.caseId,
		marketplace,
		type: "case",
		status: caseStatus(c.caseStatus),
		orderId: c.orderId ?? "",
		...(c.buyerLoginName ? { buyer: c.buyerLoginName } : {}),
		...(c.reasonForOpening ? { reason: c.reasonForOpening } : {}),
		...(c.totalAmount ? { amount: moneyFrom(c.totalAmount) } : {}),
		...(c.sellerResponseDueDate ? { respondBy: c.sellerResponseDueDate } : {}),
		createdAt: c.creationDate ?? "",
		...(c.lastModifiedDate ? { updatedAt: c.lastModifiedDate } : {}),
		...(c.closedDate ? { closedAt: c.closedDate } : {}),
	};
}

export function ebayCancellationToDispute(c: EbayCancellationRecord, marketplace: Marketplace = "ebay"): Dispute {
	return {
		id: c.cancelId,
		marketplace,
		type: "cancellation",
		status: cancellationStatus(c.cancelState ?? c.cancelStatus),
		orderId: c.orderId ?? "",
		...(c.buyerLoginName ? { buyer: c.buyerLoginName } : {}),
		...(c.cancelReason ? { reason: c.cancelReason } : {}),
		createdAt: c.creationDate ?? "",
		...(c.lastModifiedDate ? { updatedAt: c.lastModifiedDate } : {}),
		...(c.cancelClosedDate ? { closedAt: c.cancelClosedDate } : {}),
	};
}

export function ebayInquiryToDispute(i: EbayInquiryRecord, marketplace: Marketplace = "ebay"): Dispute {
	return {
		id: i.inquiryId,
		marketplace,
		type: "inquiry",
		status: returnStatus(i.inquiryStatus),
		orderId: i.orderId ?? "",
		...(i.buyerLoginName ? { buyer: i.buyerLoginName } : {}),
		...(i.itemNotReceivedReason ? { reason: i.itemNotReceivedReason } : {}),
		...(i.totalAmount ? { amount: moneyFrom(i.totalAmount) } : {}),
		...(i.sellerResponseDueDate ? { respondBy: i.sellerResponseDueDate } : {}),
		createdAt: i.creationDate ?? "",
		...(i.lastModifiedDate ? { updatedAt: i.lastModifiedDate } : {}),
		...(i.closedDate ? { closedAt: i.closedDate } : {}),
	};
}

export type { EbayCancellationRecord, EbayCaseRecord, EbayInquiryRecord, EbayReturnRecord };

export function disputeStatusForType(t: DisputeType, raw: string | undefined): DisputeStatus {
	switch (t) {
		case "return":
			return returnStatus(raw);
		case "case":
			return caseStatus(raw);
		case "cancellation":
			return cancellationStatus(raw);
		case "inquiry":
			return returnStatus(raw);
		case "payment":
			return caseStatus(raw);
	}
}
