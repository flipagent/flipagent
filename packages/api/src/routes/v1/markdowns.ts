/**
 * `/v1/markdowns/*` — item-price markdown campaigns.
 */

import { PriceMarkdownCreate, PriceMarkdownsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { createMarkdown, listMarkdowns } from "../../services/marketing/markdowns.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const markdownsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

markdownsRoute.get(
	"/",
	describeRoute({
		tags: ["Markdowns"],
		summary: "List item-price markdown campaigns",
		responses: { 200: jsonResponse("Markdowns.", PriceMarkdownsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listMarkdowns(
				{ limit: Number(c.req.query("limit") ?? 50), offset: Number(c.req.query("offset") ?? 0) },
				{
					apiKeyId: c.var.apiKey.id,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
				},
			)),
			source: "rest" as const,
		}),
);

markdownsRoute.post(
	"/",
	describeRoute({
		tags: ["Markdowns"],
		summary: "Create a markdown campaign",
		responses: { 201: jsonResponse("Created.", PriceMarkdownCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(PriceMarkdownCreate),
	async (c) =>
		c.json(
			await createMarkdown(c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			}),
			201,
		),
);
