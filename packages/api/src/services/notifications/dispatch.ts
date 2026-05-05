/**
 * Inbound-notification dispatch — turns a parsed eBay Trading
 * notification into a row (or two): always logs to
 * marketplace_notifications, and for sale events also writes to
 * expense_events with kind="sold" so it shows up in the P&L ledger
 * alongside the buy-side `purchased` row written by bridge-jobs.ts.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type ExpenseEvent, expenseEvents, marketplaceNotifications, userEbayOauth } from "../../db/schema.js";
import { type AutoDispatchOutcome, maybeAutoDispatch } from "../forwarder/auto-dispatch.js";
import { dispatchCycleEvent } from "../webhooks.js";

export interface DispatchInput {
	eventType: string;
	timestamp: string;
	recipientUserId: string | null;
	transactionId: string | null;
	itemId: string | null;
	amountCents: number | null;
	currency: string | null;
	signatureValid: boolean;
	dedupeKey: string;
	rawPayload: unknown;
}

export interface DispatchResult {
	stored: boolean; // false on dedupe collision
	notificationId: bigint | null;
	apiKeyId: string | null;
	expense: ExpenseEvent | null;
	error: string | null;
}

const SALE_EVENTS = new Set(["ItemSold", "AuctionCheckoutComplete", "FixedPriceTransaction"]);

export async function dispatchNotification(input: DispatchInput): Promise<DispatchResult> {
	const apiKeyId = await resolveApiKey(input.recipientUserId);

	const [row] = await db
		.insert(marketplaceNotifications)
		.values({
			apiKeyId,
			marketplace: "ebay_us",
			eventType: input.eventType,
			recipientUserId: input.recipientUserId,
			externalId: input.transactionId ?? input.itemId,
			signatureValid: input.signatureValid,
			dedupeKey: input.dedupeKey,
			payload: input.rawPayload as object,
		})
		.onConflictDoNothing({ target: [marketplaceNotifications.marketplace, marketplaceNotifications.dedupeKey] })
		.returning();

	if (!row) {
		// Duplicate delivery — eBay retries until 2xx. Already processed.
		return { stored: false, notificationId: null, apiKeyId, expense: null, error: null };
	}

	let expense: ExpenseEvent | null = null;
	let processError: string | null = null;
	try {
		// Only write to the ledger when signature is valid — otherwise an
		// attacker could spoof FixedPriceTransaction events to corrupt P&L.
		// Bad-signature rows still get logged above for forensics.
		if (
			input.signatureValid &&
			SALE_EVENTS.has(input.eventType) &&
			apiKeyId &&
			input.amountCents &&
			input.amountCents > 0
		) {
			expense = await writeSaleLedger(apiKeyId, input);

			// Auto-orchestration: if the sku is linked to a forwarder
			// package AND the user has eBay OAuth bound, fetch the
			// buyer address from /sell/fulfillment and queue the
			// outbound dispatch automatically. Best-effort — failures
			// fall back to "agent reads the webhook + dispatches
			// manually." The outcome is included in the webhook
			// payload so the agent sees what happened.
			let autoDispatch: AutoDispatchOutcome | null = null;
			if (input.itemId) {
				autoDispatch = await maybeAutoDispatch({
					apiKeyId,
					sku: input.itemId,
					ebayOrderId: extractOrderId(input.rawPayload),
					transactionId: input.transactionId,
				}).catch((err) => {
					console.error("[notifications.dispatch] auto-dispatch failed:", err);
					return null;
				});
			}

			// Fire `item.sold` to webhook subscribers — even when
			// auto-dispatch succeeded, the agent still wants the
			// notification (analytics, downstream automations,
			// observability). Payload includes `autoDispatch` so the
			// agent knows whether server already queued the ship-out.
			await dispatchCycleEvent(apiKeyId, "item.sold", {
				itemId: input.itemId,
				transactionId: input.transactionId,
				amountCents: input.amountCents ?? 0,
				currency: input.currency ?? "USD",
				eventType: input.eventType,
				occurredAt: input.timestamp,
				autoDispatch,
			}).catch((err) => console.error("[notifications.dispatch] item.sold webhook failed:", err));
		}
	} catch (err) {
		processError = err instanceof Error ? err.message : String(err);
	}

	await db
		.update(marketplaceNotifications)
		.set({ processedAt: new Date(), processError })
		.where(eq(marketplaceNotifications.id, row.id));

	return { stored: true, notificationId: row.id, apiKeyId, expense, error: processError };
}

async function resolveApiKey(recipientUserId: string | null): Promise<string | null> {
	if (!recipientUserId) return null;
	const [match] = await db
		.select({ apiKeyId: userEbayOauth.apiKeyId })
		.from(userEbayOauth)
		.where(
			sql`${userEbayOauth.ebayUserName} = ${recipientUserId} OR ${userEbayOauth.ebayUserId} = ${recipientUserId}`,
		)
		.limit(1);
	return match?.apiKeyId ?? null;
}

async function writeSaleLedger(apiKeyId: string, input: DispatchInput): Promise<ExpenseEvent | null> {
	const externalId = input.transactionId ?? `${input.eventType}:${input.itemId}:${input.timestamp}`;
	// Dedupe at ledger level too — if Trading sends both ItemSold and
	// AuctionCheckoutComplete for the same auction, we want one sold row
	// per transactionId, not two. Match by (api_key_id, kind, external_id).
	const [existing] = await db
		.select()
		.from(expenseEvents)
		.where(
			and(
				eq(expenseEvents.apiKeyId, apiKeyId),
				eq(expenseEvents.kind, "sold"),
				eq(expenseEvents.externalId, externalId),
			),
		)
		.limit(1);
	if (existing) return existing;

	const [inserted] = await db
		.insert(expenseEvents)
		.values({
			apiKeyId,
			kind: "sold",
			sku: input.itemId ?? "unknown",
			marketplace: "ebay_us",
			externalId,
			amountCents: input.amountCents ?? 0,
			occurredAt: parseTimestamp(input.timestamp),
			payload: {
				eventType: input.eventType,
				transactionId: input.transactionId,
				itemId: input.itemId,
				currency: input.currency,
			},
		})
		.returning();
	return inserted ?? null;
}

function parseTimestamp(ts: string): Date {
	const d = new Date(ts);
	return Number.isFinite(d.getTime()) ? d : new Date();
}

/**
 * Pull the eBay order id out of the raw Trading-API SOAP envelope.
 * Different event types stash it in different paths — search broadly
 * but conservatively (string typeguards) since the payload is
 * untyped JSON.
 */
function extractOrderId(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	const seen = new Set<unknown>();
	const queue: unknown[] = [payload];
	while (queue.length > 0) {
		const node = queue.shift();
		if (!node || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		const obj = node as Record<string, unknown>;
		// eBay's Trading API uses `OrderID` and `OrderLineItemID`.
		// REST notifications use `orderId`. Cover all common shapes.
		for (const key of ["orderId", "OrderID", "orderID", "order_id"]) {
			const v = obj[key];
			if (typeof v === "string" && v.length > 0) return v;
		}
		for (const v of Object.values(obj)) if (v && typeof v === "object") queue.push(v);
	}
	return null;
}
