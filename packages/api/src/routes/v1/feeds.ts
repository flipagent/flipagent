/**
 * `/v1/feeds/*` — bulk feed tasks (listing/order/finance, etc.).
 */

import { FeedsListResponse, FeedTaskCreate } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { createFeedTask, getFeedTask, listFeedTasks } from "../../services/feeds.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const feedsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

feedsRoute.get(
	"/",
	describeRoute({
		tags: ["Feeds"],
		summary: "List bulk feed tasks",
		responses: { 200: jsonResponse("Tasks.", FeedsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const kind = c.req.query("kind") as FeedTaskCreate["kind"] | undefined;
		return c.json({
			...(await listFeedTasks(kind, {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
			source: "rest" as const,
		});
	},
);

feedsRoute.post(
	"/",
	describeRoute({
		tags: ["Feeds"],
		summary: "Create a feed task",
		responses: { 201: jsonResponse("Created.", FeedTaskCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(FeedTaskCreate),
	async (c) =>
		c.json(
			await createFeedTask(c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			}),
			201,
		),
);

feedsRoute.get(
	"/:id",
	describeRoute({
		tags: ["Feeds"],
		summary: "Get a feed task",
		responses: { 200: { description: "Task." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const kind = (c.req.query("kind") as FeedTaskCreate["kind"] | undefined) ?? "listing";
		const t = await getFeedTask(c.req.param("id"), kind, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!t) return c.json({ error: "feed_task_not_found" }, 404);
		return c.json(t);
	},
);
