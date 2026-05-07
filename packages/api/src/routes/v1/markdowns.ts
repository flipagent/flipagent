/**
 * `/v1/markdowns/*` — item-price markdown campaigns.
 */

import { PriceMarkdownCreate, PriceMarkdownsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	createMarkdown,
	deleteMarkdown,
	getMarkdown,
	listMarkdowns,
	updateMarkdown,
} from "../../services/marketing/markdowns.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
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
					marketplace: ebayMarketplaceId(),
				},
			)),
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
				marketplace: ebayMarketplaceId(),
			}),
			201,
		),
);

markdownsRoute.get(
	"/:id",
	describeRoute({
		tags: ["Markdowns"],
		summary: "Get a markdown by id",
		responses: { 200: { description: "Markdown." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getMarkdown(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!r) return c.json({ error: "markdown_not_found" }, 404);
		return c.json({ ...r });
	},
);

markdownsRoute.put(
	"/:id",
	describeRoute({
		tags: ["Markdowns"],
		summary: "Update a markdown",
		responses: { 200: { description: "Updated." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(PriceMarkdownCreate),
	async (c) => {
		const r = await updateMarkdown(c.req.param("id"), c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

markdownsRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Markdowns"],
		summary: "Delete a markdown",
		responses: { 200: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deleteMarkdown(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ok: true });
	},
);
