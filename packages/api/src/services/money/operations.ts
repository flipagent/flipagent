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
	const res = await sellRequest<{
		amount?: EbayAmount;
		feeAmount?: EbayAmount;
		netAmount?: EbayAmount;
		count?: number;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/finances/v1/payout_summary?${params.toString()}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return {
		totalAmount: moneyFromOrZero(res?.amount),
		...(res?.feeAmount ? { feeAmount: moneyFromOrZero(res.feeAmount) } : {}),
		...(res?.netAmount ? { netAmount: moneyFromOrZero(res.netAmount) } : {}),
		count: res?.count ?? 0,
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
