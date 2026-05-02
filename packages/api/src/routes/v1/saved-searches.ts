/**
 * `/v1/saved-searches/*` — saved searches (Trading XML).
 */

import { SavedSearch, SavedSearchCreate, type SavedSearchesListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { createSavedSearch, fetchSavedSearches, removeSavedSearch } from "../../services/saved-searches.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const savedSearchesRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Trading API failed.") };

savedSearchesRoute.get(
	"/",
	describeRoute({
		tags: ["SavedSearches"],
		summary: "List saved searches",
		responses: { 200: { description: "Saved searches." }, ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const searches = await fetchSavedSearches(accessToken);
		return c.json({ searches, source: "trading" as const } satisfies SavedSearchesListResponse);
	}),
);

savedSearchesRoute.post(
	"/",
	describeRoute({
		tags: ["SavedSearches"],
		summary: "Create saved search",
		responses: { 201: jsonResponse("Created.", SavedSearch), ...COMMON },
	}),
	requireApiKey,
	tbBody(SavedSearchCreate),
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as SavedSearchCreate;
		return c.json(await createSavedSearch(accessToken, body), 201);
	}),
);

savedSearchesRoute.delete(
	"/:id",
	describeRoute({
		tags: ["SavedSearches"],
		summary: "Delete saved search",
		responses: { 204: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		await removeSavedSearch(accessToken, c.req.param("id"));
		return c.body(null, 204);
	}),
);
