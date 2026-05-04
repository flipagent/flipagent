/**
 * Bridge-mode primitive for eBay's Buy Order flow. Used internally by
 * `services/purchases/orchestrate.ts` when REST transport isn't
 * approved (`EBAY_ORDER_APPROVED=0`) — the actual buy is driven by
 * our Chrome extension via the bridge protocol.
 *
 *   initiateCheckoutSession()   → inserts a `buy_checkout_sessions` row
 *   placeOrder()                → creates a `bridge_jobs` row for the
 *                                  extension to claim + drive BIN
 *   getPurchaseOrder()          → polls the bridge job state
 *
 * Status mapping internal → eBay shape (still preserved because the
 * orchestrator still consumes `EbayPurchaseOrder`):
 *   queued | claimed                  → QUEUED_FOR_PROCESSING
 *   awaiting_user_confirm | placing   → PROCESSING
 *   completed                         → PROCESSED
 *   failed                            → FAILED
 *   cancelled | expired               → CANCELED
 */

import type { CheckoutSession, EbayPurchaseOrder, EbayPurchaseOrderStatus, LineItem } from "@flipagent/types/ebay/buy";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type BuyCheckoutSession, bridgeJobs, buyCheckoutSessions } from "../../db/schema.js";
import { createBridgeJob } from "../bridge-jobs.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches eBay's session ttl

export class BridgeCheckoutError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(code: string, status: number, message: string) {
		super(message);
		this.name = "BridgeCheckoutError";
		this.code = code;
		this.status = status;
	}
}

export interface InitiateInput {
	apiKeyId: string;
	userId: string | null;
	lineItems: ReadonlyArray<LineItem>;
	shippingAddresses?: ReadonlyArray<unknown>;
	paymentInstruments?: ReadonlyArray<unknown>;
	pricingSummary?: unknown;
}

export async function initiateCheckoutSession(input: InitiateInput): Promise<CheckoutSession> {
	if (input.lineItems.length === 0) {
		throw new BridgeCheckoutError("missing_line_items", 400, "lineItems must contain at least one item");
	}
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	const [row] = await db
		.insert(buyCheckoutSessions)
		.values({
			apiKeyId: input.apiKeyId,
			userId: input.userId,
			lineItems: input.lineItems as unknown as object,
			shippingAddresses: input.shippingAddresses as unknown as object | undefined,
			paymentInstruments: input.paymentInstruments as unknown as object | undefined,
			pricingSummary: input.pricingSummary as object | undefined,
			expiresAt,
		})
		.returning();
	if (!row) throw new BridgeCheckoutError("session_insert_failed", 500, "failed to create session");
	return toEbayCheckoutSession(row);
}

export async function getCheckoutSession(sessionId: string, apiKeyId: string): Promise<CheckoutSession | null> {
	const row = await loadSession(sessionId, apiKeyId);
	if (!row) return null;
	return toEbayCheckoutSession(row);
}

export async function placeOrder(
	sessionId: string,
	apiKeyId: string,
	userId: string | null,
): Promise<EbayPurchaseOrder> {
	const row = await loadSession(sessionId, apiKeyId);
	if (!row) throw new BridgeCheckoutError("session_not_found", 404, `No checkout session ${sessionId}`);
	if (row.status === "expired" || row.expiresAt.getTime() < Date.now()) {
		throw new BridgeCheckoutError("session_expired", 410, "Checkout session expired");
	}

	// Idempotent: if already placed, return the linked purchase order.
	if (row.status === "placed" && row.purchaseOrderId) {
		const order = await loadOrder(row.purchaseOrderId, apiKeyId);
		if (order) return toEbayPurchaseOrder(order, row.lineItems as LineItem[]);
	}

	// Bridge takes one item per task. eBay can handle multi-item carts,
	// but the BIN-click flow we drive is per-listing. Take the first item;
	// surface a 412 if the caller actually wants multi-item carting.
	const items = row.lineItems as LineItem[];
	if (items.length > 1) {
		throw new BridgeCheckoutError(
			"multi_item_unsupported_in_bridge_mode",
			412,
			"bridge mode places one line item per call; submit a separate session per item or set EBAY_ORDER_APPROVED=1",
		);
	}
	const first = items[0];
	if (!first) throw new BridgeCheckoutError("missing_line_items", 400, "session has no lineItems");

	const order = await createBridgeJob({
		apiKeyId,
		userId,
		source: "ebay",
		itemId: first.itemId,
		quantity: first.quantity,
		maxPriceCents: null,
		idempotencyKey: `checkout-session:${sessionId}`,
		metadata: { checkoutSessionId: sessionId, ...(first.variationId ? { variationId: first.variationId } : {}) },
	});

	await db
		.update(buyCheckoutSessions)
		.set({ status: "placed", purchaseOrderId: order.id, placedAt: new Date() })
		.where(eq(buyCheckoutSessions.id, sessionId));

	return toEbayPurchaseOrder(order, items);
}

export async function getPurchaseOrder(purchaseOrderId: string, apiKeyId: string): Promise<EbayPurchaseOrder | null> {
	const order = await loadOrder(purchaseOrderId, apiKeyId);
	if (!order) return null;
	// Look up the originating session to recover the lineItems shape; if
	// the order didn't come through createCheckoutSession (e.g. it was
	// queued via a bridge-only path), synthesise a lineItems array from
	// the stored itemId.
	const sessionRow = await db
		.select()
		.from(buyCheckoutSessions)
		.where(and(eq(buyCheckoutSessions.purchaseOrderId, purchaseOrderId), eq(buyCheckoutSessions.apiKeyId, apiKeyId)))
		.limit(1);
	const items =
		sessionRow[0] !== undefined
			? (sessionRow[0].lineItems as LineItem[])
			: ([{ itemId: order.itemId, quantity: order.quantity }] as LineItem[]);
	return toEbayPurchaseOrder(order, items);
}

/* ----------------------------- helpers ----------------------------- */

async function loadSession(sessionId: string, apiKeyId: string): Promise<BuyCheckoutSession | null> {
	const rows = await db
		.select()
		.from(buyCheckoutSessions)
		.where(and(eq(buyCheckoutSessions.id, sessionId), eq(buyCheckoutSessions.apiKeyId, apiKeyId)))
		.limit(1);
	return rows[0] ?? null;
}

async function loadOrder(orderId: string, apiKeyId: string): Promise<typeof bridgeJobs.$inferSelect | null> {
	const rows = await db
		.select()
		.from(bridgeJobs)
		.where(and(eq(bridgeJobs.id, orderId), eq(bridgeJobs.apiKeyId, apiKeyId)))
		.limit(1);
	return rows[0] ?? null;
}

function toEbayCheckoutSession(row: BuyCheckoutSession): CheckoutSession {
	return {
		checkoutSessionId: row.id,
		expirationDate: row.expiresAt.toISOString(),
		lineItems: row.lineItems as LineItem[],
		...(row.pricingSummary ? { pricingSummary: row.pricingSummary as Record<string, unknown> } : {}),
		...(row.shippingAddresses ? { shippingAddresses: row.shippingAddresses as unknown[] } : {}),
		...(row.paymentInstruments ? { paymentInstruments: row.paymentInstruments as unknown[] } : {}),
	};
}

function toEbayPurchaseOrder(
	order: typeof bridgeJobs.$inferSelect,
	lineItems: ReadonlyArray<LineItem>,
): EbayPurchaseOrder {
	const out: EbayPurchaseOrder = {
		purchaseOrderId: order.id,
		purchaseOrderStatus: mapInternalStatus(order.status),
		purchaseOrderCreationDate: order.createdAt.toISOString(),
		lineItems: lineItems as LineItem[],
	};
	if (order.ebayOrderId) out.ebayOrderId = order.ebayOrderId;
	if (order.receiptUrl) out.receiptUrl = order.receiptUrl;
	if (order.failureReason) out.failureReason = order.failureReason;
	return out;
}

function mapInternalStatus(s: typeof bridgeJobs.$inferSelect.status): EbayPurchaseOrderStatus {
	switch (s) {
		case "queued":
		case "claimed":
			return "QUEUED_FOR_PROCESSING";
		case "awaiting_user_confirm":
		case "placing":
			return "PROCESSING";
		case "completed":
			return "PROCESSED";
		case "failed":
			return "FAILED";
		case "cancelled":
		case "expired":
			return "CANCELED";
		default:
			return "PROCESSING";
	}
}
