/**
 * `/v1/bids/*` — buyer-side proxy bidding.
 */

import { BidCreate, BidsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getBidStatus, listBids, placeBid } from "../../services/bids.js";
import { findEligibleAuctionItems } from "../../services/compatibility.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const bidsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

bidsRoute.get(
	"/",
	describeRoute({
		tags: ["Bids"],
		summary: "List my active bids",
		responses: { 200: jsonResponse("Bids.", BidsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await listBids({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

bidsRoute.post(
	"/",
	describeRoute({
		tags: ["Bids"],
		summary: "Place a (proxy) bid on an auction",
		responses: { 201: jsonResponse("Created.", BidCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(BidCreate),
	async (c) => c.json(await placeBid(c.req.valid("json"), { apiKeyId: c.var.apiKey.id }), 201),
);

bidsRoute.get(
	"/eligible-listings",
	describeRoute({
		tags: ["Bids"],
		summary: "List items eligible for proxy bidding (no eBay endpoint)",
		description:
			"eBay does not expose a 'find eligible auctions' REST endpoint. " +
			"Use `/v1/items?status=auction` to search live auctions, or " +
			"`/v1/me/buying` for auctions you've already bid on.",
		responses: { 501: errorResponse("Endpoint does not exist."), ...COMMON },
	}),
	requireApiKey,
	// Always throws — surfaces 501 with the alternative pointers above.
	async (c) => {
		await findEligibleAuctionItems();
		return c.json({ items: [] });
	},
);

// `:listingId` comes after literal sub-routes so `/eligible-listings`
// matches the static handler instead of being captured as a param.
bidsRoute.get(
	"/:listingId",
	describeRoute({
		tags: ["Bids"],
		summary: "Current bid status for one auction listing",
		responses: { 200: { description: "Bid." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getBidStatus(c.req.param("listingId"), { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "no_bid" }, 404);
		return c.json(r);
	},
);
