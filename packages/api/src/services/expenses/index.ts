/**
 * Expenses service — append-only cost-side event log + aggregated cost
 * summary. Records what eBay's Finances API doesn't know about
 * (acquisition, forwarder, external expenses); sales / refunds /
 * eBay fees are read separately from the `/v1/sell/finances/*` mirror.
 *
 *   record(apiKey, body)     — insert one cost event (amountCents
 *                              stored as positive magnitude).
 *   summary(apiKey, window)  — counts + costs across all the owner's
 *                              API keys for the window.
 *
 * Scope: events are written against the calling API key, but `summary`
 * unions every key belonging to the same owner (userId match OR
 * ownerEmail match) so a user with multiple keys sees one expense
 * ledger.
 */

import type { ExpenseRecordRequest, ExpenseRecordResponse, ExpenseSummaryResponse } from "@flipagent/types";
import { and, eq, gte, inArray, or, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type ApiKey, apiKeys, type ExpenseEvent as ExpenseEventRow, expenseEvents } from "../../db/schema.js";

export const DEFAULT_WINDOW_DAYS = 30;

export async function record(apiKey: ApiKey, body: ExpenseRecordRequest): Promise<ExpenseRecordResponse> {
	const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
	const [row] = await db
		.insert(expenseEvents)
		.values({
			apiKeyId: apiKey.id,
			kind: body.kind,
			sku: body.sku,
			marketplace: body.marketplace ?? "ebay_us",
			externalId: body.externalId ?? null,
			amountCents: Math.abs(body.amountCents), // defensive: enforce positive even if check constraint missed
			occurredAt,
			payload: (body.payload ?? null) as ExpenseEventRow["payload"],
		})
		.returning();
	if (!row) throw new Error("expense_record_insert_returned_no_row");
	return formatEvent(row);
}

export async function summary(
	apiKey: ApiKey,
	windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ExpenseSummaryResponse> {
	const since = new Date(Date.now() - windowDays * 86_400_000);
	const ownerKeyIds = await siblingApiKeyIds(apiKey);
	if (ownerKeyIds.length === 0) return emptySummary(windowDays);

	const events = await db
		.select()
		.from(expenseEvents)
		.where(and(inArray(expenseEvents.apiKeyId, ownerKeyIds), gte(expenseEvents.occurredAt, since)));

	return aggregate(events, windowDays);
}

/**
 * Resolve every API key belonging to the same owner. Matches by userId
 * when present, falls back to ownerEmail. The calling key is always
 * included.
 */
async function siblingApiKeyIds(apiKey: ApiKey): Promise<string[]> {
	const conditions: SQL[] = [];
	if (apiKey.userId) conditions.push(eq(apiKeys.userId, apiKey.userId));
	if (apiKey.ownerEmail) conditions.push(eq(apiKeys.ownerEmail, apiKey.ownerEmail));
	if (conditions.length === 0) return [apiKey.id];
	const rows = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(or(...conditions));
	const ids = rows.map((r) => r.id);
	return ids.length > 0 ? ids : [apiKey.id];
}

function aggregate(events: ExpenseEventRow[], windowDays: number): ExpenseSummaryResponse {
	let purchasedCount = 0;
	let forwarderCount = 0;
	let expenseCount = 0;
	let acquisitionCents = 0;
	let forwarderCents = 0;
	let expenseCents = 0;
	const purchasedSkus = new Set<string>();

	for (const e of events) {
		const amt = e.amountCents;
		switch (e.kind) {
			case "purchased":
				purchasedCount++;
				acquisitionCents += amt;
				purchasedSkus.add(e.sku);
				break;
			case "forwarder_fee":
				forwarderCount++;
				forwarderCents += amt;
				break;
			case "expense":
				expenseCount++;
				expenseCents += amt;
				break;
		}
	}

	return {
		windowDays,
		asOf: new Date().toISOString(),
		counts: {
			purchased: purchasedCount,
			forwarderFee: forwarderCount,
			expense: expenseCount,
			distinctSkus: purchasedSkus.size,
		},
		costs: {
			acquisitionCents,
			forwarderCents,
			expenseCents,
			totalCostsCents: acquisitionCents + forwarderCents + expenseCents,
		},
	};
}

function emptySummary(windowDays: number): ExpenseSummaryResponse {
	return {
		windowDays,
		asOf: new Date().toISOString(),
		counts: { purchased: 0, forwarderFee: 0, expense: 0, distinctSkus: 0 },
		costs: { acquisitionCents: 0, forwarderCents: 0, expenseCents: 0, totalCostsCents: 0 },
	};
}

function formatEvent(row: ExpenseEventRow): ExpenseRecordResponse {
	return {
		id: String(row.id),
		kind: row.kind,
		sku: row.sku,
		marketplace: row.marketplace,
		externalId: row.externalId,
		amountCents: row.amountCents,
		occurredAt: row.occurredAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		payload: row.payload as ExpenseRecordResponse["payload"],
	};
}
