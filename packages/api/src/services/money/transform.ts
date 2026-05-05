/**
 * eBay sell/finances → flipagent Payout / Transaction.
 * Cents-int Money everywhere; status/type enum lowercased + stripped.
 */

import type { Marketplace, Payout, PayoutStatus, Transaction, TransactionType } from "@flipagent/types";
import { moneyFrom, moneyFromOrZero } from "../shared/money.js";

interface EbayAmount {
	value: string;
	currency: string;
}
interface EbayPayout {
	payoutId: string;
	payoutStatus: string;
	amount?: EbayAmount;
	totalFee?: EbayAmount;
	totalAmount?: EbayAmount;
	payoutInstrument?: { accountLastFourDigits?: string; instrumentType?: string };
	payoutDate?: string;
	lastModifiedDate?: string;
}
interface EbayTransaction {
	transactionId: string;
	transactionType: string;
	transactionDate: string;
	amount?: EbayAmount;
	feeAmount?: EbayAmount;
	totalFeeAmount?: EbayAmount;
	netAmount?: EbayAmount;
	orderId?: string;
	payoutId?: string;
	memo?: string;
	salesRecordReference?: string;
}

const PAYOUT_STATUS: Record<string, PayoutStatus> = {
	INITIATED: "initiated",
	SUCCEEDED: "succeeded",
	RETRYABLE_FAILED: "retryable_failed",
	TERMINAL_FAILED: "terminal_failed",
	REVERSED: "reversed",
};

const TXN_TYPE: Record<string, TransactionType> = {
	SALE: "sale",
	REFUND: "refund",
	CREDIT: "credit",
	DISPUTE: "dispute",
	SHIPPING_LABEL: "shipping_label",
	TRANSFER: "transfer",
	NON_SALE_CHARGE: "non_sale_charge",
	LOAN_REPAYMENT: "loan_repayment",
};

export function ebayPayoutToPayout(p: EbayPayout, marketplace: Marketplace = "ebay_us"): Payout {
	return {
		id: p.payoutId,
		marketplace,
		status: PAYOUT_STATUS[p.payoutStatus] ?? "initiated",
		amount: moneyFromOrZero(p.amount),
		...(p.totalFee ? { fees: moneyFrom(p.totalFee) } : {}),
		...(p.totalAmount ? { net: moneyFrom(p.totalAmount) } : {}),
		...(p.payoutInstrument?.accountLastFourDigits
			? { bankReference: `****${p.payoutInstrument.accountLastFourDigits}` }
			: {}),
		initiatedAt: p.payoutDate ?? p.lastModifiedDate ?? "",
		...(p.payoutStatus === "SUCCEEDED" && p.lastModifiedDate ? { completedAt: p.lastModifiedDate } : {}),
	};
}

export function ebayTransactionToTransaction(t: EbayTransaction, marketplace: Marketplace = "ebay_us"): Transaction {
	return {
		id: t.transactionId,
		marketplace,
		type: TXN_TYPE[t.transactionType] ?? "other",
		amount: moneyFrom(t.amount) ?? { value: 0, currency: "USD" },
		...(t.totalFeeAmount
			? { fees: moneyFrom(t.totalFeeAmount) }
			: t.feeAmount
				? { fees: moneyFrom(t.feeAmount) }
				: {}),
		...(t.netAmount ? { net: moneyFrom(t.netAmount) } : {}),
		...(t.orderId ? { orderId: t.orderId } : {}),
		...(t.payoutId ? { payoutId: t.payoutId } : {}),
		...(t.memo ? { memo: t.memo } : {}),
		occurredAt: t.transactionDate,
	};
}

export type { EbayPayout, EbayTransaction };
