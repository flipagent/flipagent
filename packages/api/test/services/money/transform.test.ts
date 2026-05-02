import { describe, expect, it } from "vitest";
import {
	type EbayPayout,
	type EbayTransaction,
	ebayPayoutToPayout,
	ebayTransactionToTransaction,
} from "../../../src/services/money/transform.js";

describe("ebayPayoutToPayout", () => {
	it("maps SUCCEEDED → succeeded with completedAt + cents-int", () => {
		const p: EbayPayout = {
			payoutId: "PO-1",
			payoutStatus: "SUCCEEDED",
			amount: { value: "1234.56", currency: "USD" },
			totalFee: { value: "12.35", currency: "USD" },
			totalAmount: { value: "1222.21", currency: "USD" },
			payoutInstrument: { accountLastFourDigits: "4242" },
			payoutDate: "2026-04-01T00:00:00Z",
			lastModifiedDate: "2026-04-01T01:00:00Z",
		};
		const out = ebayPayoutToPayout(p);
		expect(out).toMatchObject({
			id: "PO-1",
			status: "succeeded",
			amount: { value: 123456, currency: "USD" },
			fees: { value: 1235, currency: "USD" },
			net: { value: 122221, currency: "USD" },
			bankReference: "****4242",
			initiatedAt: "2026-04-01T00:00:00Z",
			completedAt: "2026-04-01T01:00:00Z",
		});
	});
	it("maps RETRYABLE_FAILED + omits completedAt", () => {
		const p: EbayPayout = {
			payoutId: "PO-2",
			payoutStatus: "RETRYABLE_FAILED",
			amount: { value: "10.00", currency: "USD" },
			payoutDate: "2026-04-01T00:00:00Z",
		};
		const out = ebayPayoutToPayout(p);
		expect(out.status).toBe("retryable_failed");
		expect(out.completedAt).toBeUndefined();
	});
});

describe("ebayTransactionToTransaction", () => {
	it("maps SALE → sale with cents", () => {
		const t: EbayTransaction = {
			transactionId: "T-1",
			transactionType: "SALE",
			transactionDate: "2026-04-01T00:00:00Z",
			amount: { value: "199.99", currency: "USD" },
			totalFeeAmount: { value: "26.99", currency: "USD" },
			netAmount: { value: "173.00", currency: "USD" },
			orderId: "27-1",
			payoutId: "PO-1",
		};
		const out = ebayTransactionToTransaction(t);
		expect(out).toMatchObject({
			id: "T-1",
			type: "sale",
			amount: { value: 19999, currency: "USD" },
			fees: { value: 2699, currency: "USD" },
			net: { value: 17300, currency: "USD" },
			orderId: "27-1",
			payoutId: "PO-1",
			occurredAt: "2026-04-01T00:00:00Z",
		});
	});
	it("falls back to 'other' for unknown types", () => {
		const t: EbayTransaction = {
			transactionId: "T-2",
			transactionType: "MYSTERY",
			transactionDate: "2026-04-01T00:00:00Z",
			amount: { value: "1.00", currency: "USD" },
		};
		expect(ebayTransactionToTransaction(t).type).toBe("other");
	});
});
