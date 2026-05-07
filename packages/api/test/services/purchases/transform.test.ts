import type { EbayPurchaseOrder } from "@flipagent/types/ebay/buy";
import { describe, expect, it } from "vitest";
import { ebayToPurchase } from "../../../src/services/purchases/transform.js";

const baseOrder: EbayPurchaseOrder = {
	purchaseOrderId: "PO-12345",
	purchaseOrderStatus: "PROCESSED",
	purchaseOrderCreationDate: "2026-04-01T12:00:00Z",
	lineItems: [{ itemId: "v1|123|0", quantity: 2 }],
	pricingSummary: {
		itemSubtotal: { value: "100.00", currency: "USD" },
		deliveryCost: { value: "9.99", currency: "USD" },
		tax: { value: "8.50", currency: "USD" },
		total: { value: "118.49", currency: "USD" },
	},
};

describe("ebayToPurchase", () => {
	it("maps PROCESSED → completed and converts cents-int", () => {
		const out = ebayToPurchase({ order: baseOrder });
		expect(out).toMatchObject({
			id: "PO-12345",
			marketplace: "ebay_us",
			status: "completed",
			items: [{ itemId: "v1|123|0", quantity: 2 }],
			pricing: {
				subtotal: { value: 10000, currency: "USD" },
				shipping: { value: 999, currency: "USD" },
				tax: { value: 850, currency: "USD" },
				total: { value: 11849, currency: "USD" },
			},
			createdAt: "2026-04-01T12:00:00Z",
		});
	});

	it("maps QUEUED_FOR_PROCESSING → queued", () => {
		const out = ebayToPurchase({ order: { ...baseOrder, purchaseOrderStatus: "QUEUED_FOR_PROCESSING" } });
		expect(out.status).toBe("queued");
	});
	it("maps CANCELED → cancelled (double-l)", () => {
		const out = ebayToPurchase({ order: { ...baseOrder, purchaseOrderStatus: "CANCELED" } });
		expect(out.status).toBe("cancelled");
	});
	it("maps PROCESSING → processing, FAILED → failed", () => {
		expect(ebayToPurchase({ order: { ...baseOrder, purchaseOrderStatus: "PROCESSING" } }).status).toBe("processing");
		expect(ebayToPurchase({ order: { ...baseOrder, purchaseOrderStatus: "FAILED" } }).status).toBe("failed");
	});

	it("preserves variationId on line items", () => {
		const out = ebayToPurchase({
			order: { ...baseOrder, lineItems: [{ itemId: "v1|9|0", quantity: 1, variationId: "VAR-1" }] },
		});
		expect(out.items[0]).toEqual({ itemId: "v1|9|0", quantity: 1, variationId: "VAR-1" });
	});

	it("forwards completedAt for terminal states", () => {
		const completedAt = "2026-04-01T13:00:00Z";
		const out = ebayToPurchase({ order: baseOrder, completedAt });
		expect(out.completedAt).toBe(completedAt);
	});
	it("does NOT set completedAt for non-terminal states", () => {
		const out = ebayToPurchase({
			order: { ...baseOrder, purchaseOrderStatus: "PROCESSING" },
			completedAt: "2026-04-01T13:00:00Z",
		});
		expect(out.completedAt).toBeUndefined();
	});

	it("forwards marketplaceOrderId / receiptUrl / failureReason when present", () => {
		const out = ebayToPurchase({
			order: {
				...baseOrder,
				ebayOrderId: "27-12345-67890",
				receiptUrl: "https://www.ebay.com/buy/order/PO-12345",
				failureReason: "card_declined",
				purchaseOrderStatus: "FAILED",
			},
		});
		expect(out.marketplaceOrderId).toBe("27-12345-67890");
		expect(out.receiptUrl).toBe("https://www.ebay.com/buy/order/PO-12345");
		expect(out.failureReason).toBe("card_declined");
	});

	it("omits pricing block entirely when no fields present", () => {
		const noPrice: EbayPurchaseOrder = { ...baseOrder, pricingSummary: undefined };
		const out = ebayToPurchase({ order: noPrice });
		expect(out.pricing).toBeUndefined();
	});
});
