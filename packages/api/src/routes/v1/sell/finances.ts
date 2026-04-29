/**
 * eBay Sell Finances API mirror (note: plural `finances` matches eBay's
 * canonical path). Payouts + per-transaction line items. Used for
 * reconciliation. OAuth passthrough required.
 *
 *   GET /sell/finances/v1/payout
 *   GET /sell/finances/v1/payout/{payoutId}
 *   GET /sell/finances/v1/transaction
 *   GET /sell/finances/v1/transaction/{transactionId}
 *   GET /sell/finances/v1/transaction_summary
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../../services/ebay/rest/client.js";
import { errorResponse } from "../../../utils/openapi.js";

export const ebaySellFinancesRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("eBay OAuth env not configured."),
};

ebaySellFinancesRoute.get(
	"/payout",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "List payouts",
		description: "Mirror of Sell Finances `getPayouts`. Each payout aggregates net seller proceeds.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellFinancesRoute.get(
	"/payout/:payoutId",
	describeRoute({ tags: ["eBay-compat"], summary: "Get a payout", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellFinancesRoute.get(
	"/transaction",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "List transactions",
		description: "Mirror of Sell Finances `getTransactions`. Per-order line items: sale, fee, refund, etc.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellFinancesRoute.get(
	"/transaction/:transactionId",
	describeRoute({ tags: ["eBay-compat"], summary: "Get a transaction", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellFinancesRoute.get(
	"/transaction_summary",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Aggregate transaction summary for a date range",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
