/**
 * `/v1/watching/*` — watch list (Trading XML AddToWatchList / RemoveFromWatchList).
 */

import { WatchAddRequest, type WatchListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { fetchWatchList, unwatchItem, watchItem } from "../../services/watching.js";
import { errorResponse, tbBody } from "../../utils/openapi.js";

export const watchingRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Trading API failed.") };

watchingRoute.get(
	"/",
	describeRoute({
		tags: ["Watching"],
		summary: "List watched items",
		responses: { 200: { description: "Watch list." }, ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) =>
		c.json({ ...(await fetchWatchList(accessToken)), source: "trading" as const } satisfies WatchListResponse),
	),
);

watchingRoute.post(
	"/",
	describeRoute({
		tags: ["Watching"],
		summary: "Add an item to watch list",
		responses: { 201: { description: "Added." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(WatchAddRequest),
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as { itemId: string };
		const r = await watchItem(accessToken, body.itemId);
		return c.json(r, 201);
	}),
);

watchingRoute.delete(
	"/:itemId",
	describeRoute({
		tags: ["Watching"],
		summary: "Remove from watch list",
		responses: { 200: { description: "Removed." }, ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => c.json(await unwatchItem(accessToken, c.req.param("itemId")))),
);
