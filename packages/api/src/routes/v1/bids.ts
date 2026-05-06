/**
 * `/v1/bids/*` — buyer-side proxy bidding.
 */

import { BidCreate, BidsListResponse } from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isExtensionPaired } from "../../auth/bridge-tokens.js";
import { requireApiKey } from "../../middleware/auth.js";
import { BidError, cancelBid, getBidStatus, listBids, placeBid } from "../../services/bids.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const bidsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing.") };

/**
 * `BidError` carries `nextActionKind` when the Buy Offer (Bidding) API
 * isn't approved on this tenant. Build the absolute remediation URL
 * from the request origin so self-hosted deploys point at their own
 * `/v1/health`, not api.flipagent.dev.
 */
function bidErrorBody(c: Context, err: BidError) {
	if (err.nextActionKind) {
		return {
			error: err.code,
			message: err.message,
			next_action: nextAction(c, err.nextActionKind),
		};
	}
	return { error: err.code, message: err.message };
}

bidsRoute.get(
	"/",
	describeRoute({
		tags: ["Bids"],
		summary: "List my active bids",
		responses: {
			200: jsonResponse("Bids.", BidsListResponse),
			502: errorResponse("Upstream eBay failed."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listBids({ apiKeyId: c.var.apiKey.id, userId: c.var.apiKey.userId })),
			source: "rest" as const,
		}),
);

bidsRoute.post(
	"/",
	describeRoute({
		tags: ["Bids"],
		summary: "Place a (proxy) bid on an auction",
		description:
			"Three transports — REST (Buy Offer Limited Release, gated by `EBAY_BIDDING_APPROVED=1`), bridge (paired Chrome extension drives the click in the buyer's logged-in session), and url (deeplink — response carries `nextAction.url` pointing at the ebay.com listing for the user to click Place Bid). Auto-picks REST → bridge (if paired) → url. Override with `transport`.",
		responses: {
			201: jsonResponse("Created.", BidCreate),
			412: errorResponse("No transport available."),
			502: errorResponse("Bridge bid placement failed."),
			504: errorResponse("Bridge client did not respond in time."),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(BidCreate),
	async (c) => {
		try {
			const bridgePaired = await isExtensionPaired(c.var.apiKey.id);
			return c.json(
				await placeBid(c.req.valid("json"), {
					apiKeyId: c.var.apiKey.id,
					userId: c.var.apiKey.userId,
					bridgePaired,
				}),
				201,
			);
		} catch (err) {
			if (err instanceof BidError) return c.json(bidErrorBody(c, err), err.status as 412);
			throw err;
		}
	},
);

bidsRoute.get(
	"/:listingId",
	describeRoute({
		tags: ["Bids"],
		summary: "Current bid status for one auction listing",
		responses: {
			200: { description: "Bid." },
			404: errorResponse("Not found."),
			412: errorResponse("No transport available."),
			502: errorResponse("Bridge bid status read failed."),
			504: errorResponse("Bridge client did not respond in time."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		try {
			const bridgePaired = await isExtensionPaired(c.var.apiKey.id);
			const r = await getBidStatus(c.req.param("listingId"), {
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId,
				bridgePaired,
			});
			if (!r) return c.json({ error: "no_bid" }, 404);
			return c.json(r);
		} catch (err) {
			if (err instanceof BidError) return c.json(bidErrorBody(c, err), err.status as 412);
			throw err;
		}
	},
);

bidsRoute.post(
	"/:listingId/cancel",
	describeRoute({
		tags: ["Bids"],
		summary: "Cancel an in-flight bridge bid for this listing",
		description:
			"Cancels the most recent bridge place-bid job that's still queued / claimed / placing for this listing. Cannot retract a bid that already landed on eBay (eBay's retraction rules are narrow and require a manual ebay.com flow). Returns the cancelled Bid, or 404 if there's no in-flight job.",
		responses: {
			200: { description: "Bid (now cancelled)." },
			404: errorResponse("No in-flight bid for this listing."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		const r = await cancelBid(c.req.param("listingId"), {
			apiKeyId: c.var.apiKey.id,
			userId: c.var.apiKey.userId,
		});
		if (!r) return c.json({ error: "no_inflight_bid" }, 404);
		return c.json(r);
	},
);
