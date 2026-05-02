/**
 * `/v1/bids/*` — buyer-side proxy bidding.
 */

import { BidCreate, BidsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { listBids, placeBid } from "../../services/bids.js";
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
		summary: "List items eligible for proxy bidding",
		responses: { 200: { description: "Items." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await findEligibleAuctionItems()), source: "rest" as const }),
);
