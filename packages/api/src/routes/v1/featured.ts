/**
 * `/v1/featured` — eBay's curated daily/event deals.
 */

import { FeaturedListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { listFeatured } from "../../services/featured.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const featuredRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

featuredRoute.get(
	"/",
	describeRoute({
		tags: ["Featured"],
		summary: "List eBay's curated daily deals",
		responses: { 200: jsonResponse("Deals.", FeaturedListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const kind = (c.req.query("kind") as "daily_deal" | "event_deal" | undefined) ?? "daily_deal";
		const r = await listFeatured(kind, {
			limit: Number(c.req.query("limit") ?? 50),
			offset: Number(c.req.query("offset") ?? 0),
			categoryIds: c.req.query("categoryIds"),
		});
		return c.json({ ...r, source: "rest" as const });
	},
);
