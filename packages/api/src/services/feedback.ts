/**
 * `/v1/feedback/*` adapter — Trading XML `GetItemsAwaitingFeedback`
 * normalized to `FeedbackAwaiting`. (List/leave-feedback Trading calls
 * are wired inline in the route since they're already small.)
 */

import type { FeedbackAwaiting } from "@flipagent/types";
import { getItemsAwaitingFeedback } from "./ebay/trading/feedback.js";
import { toCents } from "./shared/money.js";

export async function fetchAwaitingFeedback(accessToken: string, role: "buyer" | "seller"): Promise<FeedbackAwaiting> {
	const rows = await getItemsAwaitingFeedback(accessToken, role === "seller" ? "Seller" : "Buyer");
	return {
		role,
		items: rows.map((row) => ({
			orderId: row.orderId,
			listingId: row.listingId,
			counterparty: row.counterparty,
			title: row.title,
			price: { value: toCents(row.priceValue), currency: row.priceCurrency },
			transactionDate: row.transactionDate,
		})),
	};
}
