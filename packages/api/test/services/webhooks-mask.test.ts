import { describe, expect, it } from "vitest";
import { maskWebhookPayload } from "../../src/services/webhooks.js";

describe("maskWebhookPayload", () => {
	it("redacts top-level email + phone keys", () => {
		const out = maskWebhookPayload({ email: "x@y.com", phone: "555-0001", id: "abc" }) as Record<string, unknown>;
		expect(out.email).toBe("[redacted]");
		expect(out.phone).toBe("[redacted]");
		expect(out.id).toBe("abc");
	});

	it("recurses into nested objects (Stripe-shape)", () => {
		const input = {
			data: {
				object: {
					customer: "cus_123",
					customer_email: "buyer@example.com",
					// Whole shipping_address subtree gets redacted at the parent
					// key — we don't need to descend into line1/postal_code since
					// the entire address is the unit we don't want at rest.
					shipping_address: { line1: "1 St", postal_code: "94107" },
				},
			},
		};
		const out = maskWebhookPayload(input) as {
			data: { object: { customer: string; customer_email: string; shipping_address: unknown } };
		};
		expect(out.data.object.customer_email).toBe("[redacted]");
		expect(out.data.object.shipping_address).toBe("[redacted]");
		expect(out.data.object.customer).toBe("cus_123");
	});

	it("handles arrays of mixed objects", () => {
		const out = maskWebhookPayload([{ token: "tok_1", id: "i1" }, { name: "alice" }]) as Array<
			Record<string, unknown>
		>;
		expect(out[0].token).toBe("[redacted]");
		expect(out[0].id).toBe("i1");
		expect(out[1].name).toBe("alice");
	});

	it("redacts card-shaped fields (last4 + cvc)", () => {
		const out = maskWebhookPayload({ card: { last4: "4242", cvc: "123", brand: "visa" } }) as Record<string, unknown>;
		expect(out.card).toBe("[redacted]");
	});

	it("leaves primitives unchanged", () => {
		expect(maskWebhookPayload("hello")).toBe("hello");
		expect(maskWebhookPayload(42)).toBe(42);
		expect(maskWebhookPayload(null)).toBe(null);
	});
});
