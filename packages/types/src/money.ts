/**
 * `/v1/payouts` + `/v1/transactions` — money in. Both wrap eBay's
 * sell/finances surface and surface cents-int amounts so quant /
 * accounting code never juggles dollar strings.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page } from "./_common.js";

export const PayoutStatus = Type.Union(
	[
		Type.Literal("initiated"),
		Type.Literal("succeeded"),
		Type.Literal("retryable_failed"),
		Type.Literal("terminal_failed"),
		Type.Literal("reversed"),
	],
	{ $id: "PayoutStatus" },
);
export type PayoutStatus = Static<typeof PayoutStatus>;

export const Payout = Type.Object(
	{
		id: Type.String({ description: "eBay `payoutId`." }),
		marketplace: Marketplace,
		status: PayoutStatus,
		amount: Money,
		fees: Type.Optional(Money),
		net: Type.Optional(Money),
		bankReference: Type.Optional(Type.String()),
		initiatedAt: Type.String(),
		completedAt: Type.Optional(Type.String()),
	},
	{ $id: "Payout" },
);
export type Payout = Static<typeof Payout>;

export const TransactionType = Type.Union(
	[
		Type.Literal("sale"),
		Type.Literal("refund"),
		Type.Literal("credit"),
		Type.Literal("dispute"),
		Type.Literal("shipping_label"),
		Type.Literal("transfer"),
		Type.Literal("non_sale_charge"),
		Type.Literal("loan_repayment"),
		Type.Literal("other"),
	],
	{ $id: "TransactionType" },
);
export type TransactionType = Static<typeof TransactionType>;

export const Transaction = Type.Object(
	{
		id: Type.String({ description: "eBay `transactionId`." }),
		marketplace: Marketplace,
		type: TransactionType,
		amount: Money,
		fees: Type.Optional(Money),
		net: Type.Optional(Money),
		orderId: Type.Optional(Type.String()),
		payoutId: Type.Optional(Type.String()),
		memo: Type.Optional(Type.String()),
		occurredAt: Type.String(),
	},
	{ $id: "Transaction" },
);
export type Transaction = Static<typeof Transaction>;

export const PayoutsListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		status: Type.Optional(PayoutStatus),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "PayoutsListQuery" },
);
export type PayoutsListQuery = Static<typeof PayoutsListQuery>;

export const TransactionsListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		type: Type.Optional(TransactionType),
		orderId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "TransactionsListQuery" },
);
export type TransactionsListQuery = Static<typeof TransactionsListQuery>;

export const PayoutsListResponse = Type.Composite([Page, Type.Object({ payouts: Type.Array(Payout) })], {
	$id: "PayoutsListResponse",
});
export type PayoutsListResponse = Static<typeof PayoutsListResponse>;

export const TransactionsListResponse = Type.Composite([Page, Type.Object({ transactions: Type.Array(Transaction) })], {
	$id: "TransactionsListResponse",
});
export type TransactionsListResponse = Static<typeof TransactionsListResponse>;

/* ----- /v1/payouts/summary ------------------------------------------- */

export const PayoutSummary = Type.Object(
	{
		totalAmount: Money,
		// Count of payouts in the period (Stripe-style "payouts.count").
		count: Type.Integer({ minimum: 0 }),
		// Count of monetary transactions (order payments + buyer refunds +
		// seller credits) ROLLED INTO those payouts. Always returned.
		transactionCount: Type.Integer({ minimum: 0 }),
		from: Type.String(),
		to: Type.String(),
	},
	{ $id: "PayoutSummary" },
);
export type PayoutSummary = Static<typeof PayoutSummary>;
