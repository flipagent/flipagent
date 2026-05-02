/**
 * `/v1/charities` — search & lookup eBay for Charity organizations.
 */

import { CharitiesListQuery, CharitiesListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getCharity, listCharities } from "../../services/charities.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const charitiesRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

charitiesRoute.get(
	"/",
	describeRoute({
		tags: ["Charities"],
		summary: "Search eBay for Charity organizations",
		parameters: paramsFor("query", CharitiesListQuery),
		responses: { 200: jsonResponse("Charities.", CharitiesListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", CharitiesListQuery),
	async (c) => c.json({ ...(await listCharities(c.req.valid("query"))), source: "rest" as const }),
);

charitiesRoute.get(
	"/:id",
	describeRoute({
		tags: ["Charities"],
		summary: "Get a charity by id or EIN",
		responses: { 200: { description: "Charity." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getCharity(c.req.param("id"));
		if (!r) return c.json({ error: "charity_not_found" }, 404);
		return c.json(r);
	},
);
