import { describe, expect, it } from "vitest";
import {
	ebayCancellationToDispute,
	ebayCaseToDispute,
	ebayInquiryToDispute,
	ebayReturnToDispute,
} from "../../../src/services/disputes/transform.js";

describe("disputes transform — 4 types unified", () => {
	it("maps a return to type='return' with cents amount", () => {
		const d = ebayReturnToDispute({
			returnId: "R-1",
			creationDate: "2026-04-01T00:00:00Z",
			itemId: "9",
			orderId: "27-1",
			state: "WAITING_FOR_SELLER",
			buyerLoginName: "buyer123",
			reason: "ITEM_DAMAGED",
			totalAmount: { value: "50.00", currencyCode: "USD" },
			sellerResponseDueDate: "2026-04-04T00:00:00Z",
		});
		expect(d).toMatchObject({
			type: "return",
			id: "R-1",
			status: "seller_action_required",
			orderId: "27-1",
			buyer: "buyer123",
			reason: "ITEM_DAMAGED",
			amount: { value: 5000, currency: "USD" },
			respondBy: "2026-04-04T00:00:00Z",
		});
	});

	it("maps a case escalated → escalated", () => {
		const d = ebayCaseToDispute({
			caseId: "C-1",
			creationDate: "2026-04-01T00:00:00Z",
			caseStatus: "ESCALATED",
		});
		expect(d.type).toBe("case");
		expect(d.status).toBe("escalated");
	});

	it("maps a cancellation to type='cancellation'", () => {
		const d = ebayCancellationToDispute({
			cancelId: "X-1",
			creationDate: "2026-04-01T00:00:00Z",
			cancelState: "PENDING_SELLER_RESPONSE",
		});
		expect(d.type).toBe("cancellation");
		expect(d.status).toBe("seller_action_required");
	});

	it("maps an inquiry to type='inquiry'", () => {
		const d = ebayInquiryToDispute({
			inquiryId: "I-1",
			creationDate: "2026-04-01T00:00:00Z",
			inquiryStatus: "CLOSED",
			closedDate: "2026-04-05T00:00:00Z",
		});
		expect(d.type).toBe("inquiry");
		expect(d.status).toBe("closed");
		expect(d.closedAt).toBe("2026-04-05T00:00:00Z");
	});
});
