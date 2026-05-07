/**
 * `/v1/bids/*` — buyer-side proxy bidding.
 *
 * Same contract as `/v1/purchases`: terminal status (the bid is on
 * file with eBay) or non-terminal with `nextAction.url` (open the URL
 * for the user to click Place Bid on the marketplace UI). The server
 * picks how the bid flows internally; the response shape is identical.
 */

import { BidCreate, BidsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isExtensionPaired } from "../../auth/bridge-tokens.js";
import { requireApiKey } from "../../middleware/auth.js";
import { BidError, cancelBid, getBidStatus, listBids, placeBid } from "../../services/bids.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const bidsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing.") };

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
	async (c) => c.json(await listBids({ apiKeyId: c.var.apiKey.id, userId: c.var.apiKey.userId })),
);

bidsRoute.post(
	"/",
	describeRoute({
		tags: ["Bids"],
		summary: "Place a (proxy) bid on an auction",
		description:
			"Place a proxy bid. The response is either terminal (bid is on file with eBay) or non-terminal with `nextAction.url` (direct the user to that URL to click Place Bid on the marketplace UI, then poll `GET /v1/bids/{listingId}`). Either way the response shape is identical.",
		responses: {
			201: jsonResponse("Created.", BidCreate),
			502: errorResponse("Upstream marketplace failed."),
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
			if (err instanceof BidError)
				return c.json({ error: err.code, message: err.message }, err.status as 412 | 502 | 504);
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
			502: errorResponse("Upstream marketplace failed."),
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
			if (err instanceof BidError)
				return c.json({ error: err.code, message: err.message }, err.status as 412 | 502 | 504);
			throw err;
		}
	},
);

bidsRoute.post(
	"/:listingId/cancel",
	describeRoute({
		tags: ["Bids"],
		summary: "Cancel an in-flight bid for this listing",
		description:
			"Cancels the most recent place-bid tracking row that's still queued / claimed / placing for this listing. Cannot retract a bid that already landed on eBay (eBay's retraction rules are narrow and require a manual ebay.com flow). Returns the cancelled Bid, or 404 if there's no in-flight job.",
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
