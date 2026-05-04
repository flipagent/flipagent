/**
 * sell/finances ops — payouts (list + summary), transactions, transfers.
 */

import type {
	Payout,
	PayoutSummary,
	PayoutsListQuery,
	Transaction,
	TransactionsListQuery,
	Transfer,
	TransfersListResponse,
} from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "../ebay/rest/user-client.js";
import { moneyFromOrZero } from "../shared/money.js";
import {
	type EbayPayout,
	type EbayTransaction,
	ebayPayoutToPayout,
	ebayTransactionToTransaction,
} from "./transform.js";

export interface MoneyContext {
	apiKeyId: string;
	marketplace?: string;
}

interface EbayAmount {
	value: string;
	currency: string;
}

interface EbayTransfer {
	transferId: string;
	amount: EbayAmount;
	transferType: string;
	reason?: string;
	bankReference?: string;
	transferDate: string;
}

export async function listPayouts(
	q: PayoutsListQuery,
	ctx: MoneyContext,
): Promise<{ payouts: Payout[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.status) params.set("filter", `payoutStatus:{${q.status.toUpperCase()}}`);
	const res = await sellRequest<{ payouts?: EbayPayout[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/finances/v1/payout?${params.toString()}`,
		marketplace: ctx.marketplace,
	});
	return {
		payouts: (res?.payouts ?? []).map((p) => ebayPayoutToPayout(p, q.marketplace)),
		limit,
		offset,
		...(res?.total !== undefined ? { total: res.total } : {}),
	};
}

export async function getPayoutSummary(from: string, to: string, ctx: MoneyContext): Promise<PayoutSummary> {
	const params = new URLSearchParams({ filter: `payoutDate:[${from}..${to}]` });
	// `PayoutSummaryResponse` per OAS3 spec
	// (`references/ebay-mcp/docs/_mirror/sell_finances_v1_oas3.json`)
	// returns ONLY `{ amount, payoutCount, transactionCount }`. The
	// previous wrapper destructured `feeAmount`, `netAmount`, `count` —
	// none exist in the spec, so every getPayoutSummary call has been
	// silently returning 0 for `count` (and never populated fee/net).
	// Verified via field-diff 2026-05-03. eBay doesn't break down fee
	// vs net at the summary level — that's per-transaction. We surface
	// both `payoutCount` (Stripe-style: count of payouts) and
	// `transactionCount` (Stripe-style: count of underlying line items).
	const res = await sellRequest<{
		amount?: EbayAmount;
		payoutCount?: number;
		transactionCount?: number;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/finances/v1/payout_summary?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return {
		totalAmount: moneyFromOrZero(res?.amount),
		count: res?.payoutCount ?? 0,
		transactionCount: res?.transactionCount ?? 0,
		from,
		to,
	};
}

export async function listTransactions(
	q: TransactionsListQuery,
	ctx: MoneyContext,
): Promise<{ transactions: Transaction[]; limit: number; offset: number; total?: number }> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	const filters: string[] = [];
	if (q.type) filters.push(`transactionType:{${q.type.toUpperCase()}}`);
	if (q.orderId) filters.push(`orderId:{${q.orderId}}`);
	if (filters.length) params.set("filter", filters.join(","));
	const res = await sellRequest<{ transactions?: EbayTransaction[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/finances/v1/transaction?${params.toString()}`,
		marketplace: ctx.marketplace,
	});
	return {
		transactions: (res?.transactions ?? []).map((t) => ebayTransactionToTransaction(t, q.marketplace)),
		limit,
		offset,
		...(res?.total !== undefined ? { total: res.total } : {}),
	};
}

/**
 * Per-currency summary of in-process funds. Returns money pending,
 * available, on-hold buckets per currency. Used by sellers to see
 * cash-flow status without scanning all individual transactions.
 * Verified live 2026-05-03 — apiz host required.
 */
export async function getSellerFundsSummary(
	ctx: MoneyContext,
): Promise<{ amounts: Array<{ currency: string; status: string; amount: { value: string } }> }> {
	const res = await sellRequest<{
		availableAmount?: { value: string; currency: string };
		processingAmount?: { value: string; currency: string };
		fundingHoldAmount?: { value: string; currency: string };
		totalReceivedAmount?: { value: string; currency: string };
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/finances/v1/seller_funds_summary",
	}).catch(swallowEbay404);
	const out: Array<{ currency: string; status: string; amount: { value: string } }> = [];
	if (res?.availableAmount)
		out.push({
			currency: res.availableAmount.currency,
			status: "available",
			amount: { value: res.availableAmount.value },
		});
	if (res?.processingAmount)
		out.push({
			currency: res.processingAmount.currency,
			status: "processing",
			amount: { value: res.processingAmount.value },
		});
	if (res?.fundingHoldAmount)
		out.push({
			currency: res.fundingHoldAmount.currency,
			status: "hold",
			amount: { value: res.fundingHoldAmount.value },
		});
	if (res?.totalReceivedAmount)
		out.push({
			currency: res.totalReceivedAmount.currency,
			status: "received_total",
			amount: { value: res.totalReceivedAmount.value },
		});
	return { amounts: out };
}

/**
 * Aggregate summary of monetary transactions over a filter window.
 * Companion to `listTransactions` — sums + counts instead of detail.
 */
export async function getTransactionSummary(
	from: string,
	to: string,
	ctx: MoneyContext,
): Promise<{
	count: number;
	creditAmount?: { value: string; currency: string };
	debitAmount?: { value: string; currency: string };
}> {
	const params = new URLSearchParams({ filter: `transactionDate:[${from}..${to}]` });
	const res = await sellRequest<{
		creditCount?: number;
		debitCount?: number;
		creditAmount?: { value: string; currency: string };
		debitAmount?: { value: string; currency: string };
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/finances/v1/transaction_summary?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return {
		count: (res?.creditCount ?? 0) + (res?.debitCount ?? 0),
		...(res?.creditAmount ? { creditAmount: res.creditAmount } : {}),
		...(res?.debitAmount ? { debitAmount: res.debitAmount } : {}),
	};
}

/**
 * Real `payment_dispute_summary` (count + per-status breakdown), separate
 * from listing disputes via `payment_dispute/search`. eBay returns counts
 * filtered by lookback days. Wrapped 2026-05-03.
 */
export async function getPaymentDisputeSummary(
	lookBackDays: number,
	ctx: MoneyContext,
): Promise<{ openCount: number; needsActionCount: number; totalCount: number }> {
	const res = await sellRequest<{
		disputeSummaries?: Array<{ status: string; count: number }>;
		openDisputeCount?: number;
		needsResponseCount?: number;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/fulfillment/v1/payment_dispute_summary?look_back_days=${lookBackDays}`,
	}).catch(swallowEbay404);
	let openCount = res?.openDisputeCount ?? 0;
	let needsActionCount = res?.needsResponseCount ?? 0;
	let totalCount = 0;
	for (const s of res?.disputeSummaries ?? []) {
		totalCount += s.count;
		if (s.status === "OPEN") openCount = s.count;
		if (s.status === "NEEDS_RESPONSE") needsActionCount = s.count;
	}
	return { openCount, needsActionCount, totalCount };
}

export async function listTransfers(
	q: { limit?: number; offset?: number },
	ctx: MoneyContext,
): Promise<TransfersListResponse> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	const res = await sellRequest<{ transfers?: EbayTransfer[]; total?: number }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/finances/v1/transfer?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	const transfers: Transfer[] = (res?.transfers ?? []).map((t) => ({
		id: t.transferId,
		amount: moneyFromOrZero(t.amount),
		direction: t.transferType?.toUpperCase() === "DEBIT" ? "debit" : "credit",
		...(t.reason ? { reason: t.reason } : {}),
		...(t.bankReference ? { bankReference: t.bankReference } : {}),
		executedAt: t.transferDate,
	}));
	return { transfers, limit, offset, ...(res?.total !== undefined ? { total: res.total } : {}), source: "rest" };
}
