/**
 * `/v1/expenses/*` schemas — append-only cost-side log + aggregated
 * cost summary. The agent records what eBay's Finances API doesn't
 * know about: acquisition cost, forwarder fees, external expenses
 * (packaging, supplies, off-platform ad spend).
 *
 * Sales / refunds / eBay fees stay in eBay's ledger — read via
 * `/v1/finance/*` (eBay Finances API mirror). A future
 * `/v1/portfolio/pnl` endpoint will join the two server-side; for now
 * `/v1/expenses/summary` returns only the cost side.
 *
 * `amountCents` is always a positive magnitude — we don't store
 * signed amounts.
 */

import { type Static, Type } from "@sinclair/typebox";

export const ExpenseEventKind = Type.Union(
	[Type.Literal("purchased"), Type.Literal("forwarder_fee"), Type.Literal("expense"), Type.Literal("sold")],
	{ $id: "ExpenseEventKind" },
);
export type ExpenseEventKind = Static<typeof ExpenseEventKind>;

/* ----------------------- POST /v1/expenses/record ----------------------- */

export const ExpenseRecordRequest = Type.Object(
	{
		kind: ExpenseEventKind,
		/** Caller's SKU identifier — opaque string used to join purchase ↔ sale events. Match this to the eBay listing's `sku` so /v1/portfolio/pnl can join with eBay Finances later. */
		sku: Type.String({ minLength: 1, maxLength: 200 }),
		marketplace: Type.Optional(Type.String({ description: "Default `ebay_us`." })),
		/** Marketplace-side reference: eBay itemId (the listing we bought from), forwarder shipment id, etc. */
		externalId: Type.Optional(Type.String({ maxLength: 200 })),
		/** Always positive magnitude. */
		amountCents: Type.Integer({ minimum: 0 }),
		occurredAt: Type.Optional(Type.String({ format: "date-time", description: "Defaults to now (UTC)." })),
		/**
		 * Free-form context. For `purchased` events, set
		 * `predictedNetCents` (and optionally `predictedDaysToSell`) to
		 * preserve evaluate()'s prediction for the future calibration
		 * loop in `/v1/portfolio/pnl`.
		 */
		payload: Type.Optional(Type.Unknown()),
	},
	{ $id: "ExpenseRecordRequest" },
);
export type ExpenseRecordRequest = Static<typeof ExpenseRecordRequest>;

export const ExpenseEvent = Type.Object(
	{
		id: Type.String(),
		kind: ExpenseEventKind,
		sku: Type.String(),
		marketplace: Type.String(),
		externalId: Type.Union([Type.String(), Type.Null()]),
		amountCents: Type.Integer(),
		occurredAt: Type.String({ format: "date-time" }),
		createdAt: Type.String({ format: "date-time" }),
		payload: Type.Union([Type.Unknown(), Type.Null()]),
	},
	{ $id: "ExpenseEvent" },
);
export type ExpenseEvent = Static<typeof ExpenseEvent>;

export const ExpenseRecordResponse = ExpenseEvent;
export type ExpenseRecordResponse = ExpenseEvent;

/* ---------------------- GET /v1/expenses/summary ---------------------- */

export const ExpenseSummaryResponse = Type.Object(
	{
		windowDays: Type.Integer(),
		asOf: Type.String({ format: "date-time" }),
		counts: Type.Object({
			purchased: Type.Integer(),
			forwarderFee: Type.Integer(),
			expense: Type.Integer(),
			/** Distinct SKUs with at least one `purchased` event in the window. */
			distinctSkus: Type.Integer(),
		}),
		costs: Type.Object({
			acquisitionCents: Type.Integer({ description: "Sum of `purchased` amounts." }),
			forwarderCents: Type.Integer({ description: "Sum of `forwarder_fee` amounts." }),
			expenseCents: Type.Integer({ description: "Sum of `expense` amounts." }),
			totalCostsCents: Type.Integer({ description: "Sum of all three above." }),
		}),
	},
	{ $id: "ExpenseSummaryResponse" },
);
export type ExpenseSummaryResponse = Static<typeof ExpenseSummaryResponse>;
