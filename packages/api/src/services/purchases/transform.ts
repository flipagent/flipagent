/**
 * eBay `EbayPurchaseOrder` ↔ flipagent `Purchase`.
 *
 * Status enum maps `QUEUED_FOR_PROCESSING|PROCESSING|PROCESSED|FAILED|CANCELED`
 * → `queued|processing|completed|failed|cancelled`. Pricing converts
 * eBay's `Amount` (string value) to cents-int Money. `lineItems[]` →
 * `items[]` is a near-1:1 with `itemId|quantity|variationId`.
 */

import type { Marketplace, Purchase, PurchasePricing, PurchaseStatus } from "@flipagent/types";
import type { EbayPurchaseOrder, EbayPurchaseOrderStatus, PricingSummary } from "@flipagent/types/ebay/buy";
import { moneyFrom } from "../shared/money.js";

const STATUS_FROM_EBAY: Record<EbayPurchaseOrderStatus, PurchaseStatus> = {
	QUEUED_FOR_PROCESSING: "queued",
	PROCESSING: "processing",
	PROCESSED: "completed",
	FAILED: "failed",
	CANCELED: "cancelled",
};

const TERMINAL: ReadonlySet<PurchaseStatus> = new Set(["completed", "failed", "cancelled"]);

function pricingFrom(summary: PricingSummary | undefined): PurchasePricing | undefined {
	if (!summary) return undefined;
	const out: PurchasePricing = {};
	const subtotal = moneyFrom(summary.itemSubtotal);
	if (subtotal) out.subtotal = subtotal;
	const shipping = moneyFrom(summary.deliveryCost);
	if (shipping) out.shipping = shipping;
	const tax = moneyFrom(summary.tax);
	if (tax) out.tax = tax;
	const total = moneyFrom(summary.total);
	if (total) out.total = total;
	return Object.keys(out).length > 0 ? out : undefined;
}

export interface ToPurchaseInput {
	order: EbayPurchaseOrder;
	marketplace?: Marketplace;
	completedAt?: string;
}

export function ebayToPurchase(input: ToPurchaseInput): Purchase {
	const { order } = input;
	const status = STATUS_FROM_EBAY[order.purchaseOrderStatus];
	const out: Purchase = {
		id: order.purchaseOrderId,
		marketplace: input.marketplace ?? "ebay_us",
		status,
		items: order.lineItems.map((li) => ({
			itemId: li.itemId,
			quantity: li.quantity,
			...(li.variationId ? { variationId: li.variationId } : {}),
		})),
		createdAt: order.purchaseOrderCreationDate,
	};
	const pricing = pricingFrom(order.pricingSummary);
	if (pricing) out.pricing = pricing;
	if (order.ebayOrderId) out.marketplaceOrderId = order.ebayOrderId;
	if (order.receiptUrl) out.receiptUrl = order.receiptUrl;
	if (order.failureReason) out.failureReason = order.failureReason;
	if (input.completedAt && TERMINAL.has(status)) out.completedAt = input.completedAt;
	return out;
}
