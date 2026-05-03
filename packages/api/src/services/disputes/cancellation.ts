/**
 * Post-Order v2 cancellation create + eligibility — for seller-initiated
 * order cancellations (ship-side change of mind, OOS, etc.). Distinct
 * from `respondToDispute(action='accept')` which acknowledges a
 * BUYER-initiated cancellation request.
 *
 * Wraps `/post-order/v2/cancellation` (POST) and
 * `/post-order/v2/cancellation/check_eligibility` (POST). Both go
 * through the IAF auth pipe handled in `sellRequest`.
 */

import { sellRequest } from "../ebay/rest/user-client.js";

export interface CancellationContext {
	apiKeyId: string;
}

export interface CancellationItem {
	itemId: string;
	transactionId?: string;
}

const CANCEL_REASONS = ["BUYER_ASKED_CANCEL", "OUT_OF_STOCK_OR_CANNOT_FULFILL", "ADDRESS_ISSUES"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

interface UpstreamCancellationCheck {
	eligibleForCancellation?: boolean;
	reasonsForCancellation?: Array<{ reasonForCancellation?: string }>;
	error?: { errorId?: number; errorMessage?: string };
}

export async function checkCancellationEligibility(
	legacyOrderId: string,
	items: CancellationItem[],
	ctx: CancellationContext,
): Promise<{ eligible: boolean; reasons: string[] }> {
	const res = await sellRequest<UpstreamCancellationCheck>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/cancellation/check_eligibility",
		body: { legacyOrderId, items },
	});
	return {
		eligible: res?.eligibleForCancellation ?? false,
		reasons: (res?.reasonsForCancellation ?? []).map((r) => r.reasonForCancellation ?? "").filter(Boolean),
	};
}

interface UpstreamCancellationResponse {
	cancelId?: string;
	cancelStatus?: string;
}

export async function createCancellation(
	legacyOrderId: string,
	cancelReason: CancelReason,
	items: CancellationItem[],
	ctx: CancellationContext,
): Promise<{ cancelId: string | null; status: string | null }> {
	const res = await sellRequest<UpstreamCancellationResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/post-order/v2/cancellation",
		body: { legacyOrderId, cancelReason, items },
	});
	return {
		cancelId: res?.cancelId ?? null,
		status: res?.cancelStatus ?? null,
	};
}
