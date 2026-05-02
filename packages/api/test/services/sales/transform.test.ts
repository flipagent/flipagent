import { describe, expect, it } from "vitest";
import { type EbayOrder, ebayOrderToSale } from "../../../src/services/sales/transform.js";

const baseOrder: EbayOrder = {
	orderId: "27-12345-67890",
	creationDate: "2026-04-01T10:00:00Z",
	orderFulfillmentStatus: "NOT_STARTED",
	orderPaymentStatus: "PAID",
	buyer: { username: "buyer123", email: "buyer@example.com" },
	lineItems: [
		{
			lineItemId: "LI-1",
			legacyItemId: "987654321",
			title: "Air Jordan 1",
			quantity: 1,
			lineItemCost: { value: "199.99", currency: "USD" },
			image: { imageUrl: "https://img/aj1.jpg" },
		},
	],
	pricingSummary: {
		priceSubtotal: { value: "199.99", currency: "USD" },
		deliveryCost: { value: "9.99", currency: "USD" },
		tax: { value: "16.20", currency: "USD" },
		total: { value: "226.18", currency: "USD" },
	},
	fulfillmentStartInstructions: [
		{
			shippingStep: {
				shipTo: {
					fullName: "Jane Doe",
					contactAddress: {
						addressLine1: "1 Main St",
						city: "Brooklyn",
						stateOrProvince: "NY",
						postalCode: "11201",
						countryCode: "US",
					},
				},
			},
		},
	],
};

describe("ebayOrderToSale", () => {
	it("maps NOT_STARTED → paid + cents-int pricing", () => {
		const sale = ebayOrderToSale(baseOrder);
		expect(sale.status).toBe("paid");
		expect(sale.pricing.total).toEqual({ value: 22618, currency: "USD" });
		expect(sale.pricing.subtotal).toEqual({ value: 19999, currency: "USD" });
		expect(sale.items[0]?.price).toEqual({ value: 19999, currency: "USD" });
	});

	it("maps FULFILLED with deliveredAt → delivered, without → shipped", () => {
		const shipped = ebayOrderToSale({
			...baseOrder,
			orderFulfillmentStatus: "FULFILLED",
			fulfillments: [{ trackingNumber: "1Z", shippingCarrierCode: "UPS", shippedDate: "2026-04-02T00:00:00Z" }],
		});
		expect(shipped.status).toBe("shipped");
		expect(shipped.shipping?.trackingNumber).toBe("1Z");

		const delivered = ebayOrderToSale({
			...baseOrder,
			orderFulfillmentStatus: "FULFILLED",
			fulfillments: [
				{
					trackingNumber: "1Z",
					shippingCarrierCode: "UPS",
					shippedDate: "2026-04-02T00:00:00Z",
					actualDeliveryDate: "2026-04-05T00:00:00Z",
				},
			],
		});
		expect(delivered.status).toBe("delivered");
		expect(delivered.shipping?.deliveredAt).toBe("2026-04-05T00:00:00Z");
	});

	it("maps cancelled state", () => {
		const sale = ebayOrderToSale({ ...baseOrder, cancelStatus: { cancelState: "CANCELED" } });
		expect(sale.status).toBe("cancelled");
	});

	it("maps refunded payment status", () => {
		const sale = ebayOrderToSale({ ...baseOrder, orderPaymentStatus: "REFUNDED" });
		expect(sale.status).toBe("refunded");
	});

	it("preserves buyer + shipTo address", () => {
		const sale = ebayOrderToSale(baseOrder);
		expect(sale.buyer).toEqual({ username: "buyer123", email: "buyer@example.com" });
		expect(sale.shipTo).toMatchObject({
			line1: "1 Main St",
			city: "Brooklyn",
			region: "NY",
			postalCode: "11201",
			country: "US",
			name: "Jane Doe",
		});
	});
});
