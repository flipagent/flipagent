/**
 * `/v1/locations/*` — merchant warehouse / pickup location CRUD.
 */

import { Location, LocationCreate, LocationsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	createLocation,
	deleteLocation,
	getLocation,
	listLocations,
	setLocationStatus,
} from "../../services/locations.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const locationsRoute = new Hono();
const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

locationsRoute.get(
	"/",
	describeRoute({
		tags: ["Locations"],
		summary: "List merchant locations",
		responses: { 200: jsonResponse("Locations.", LocationsListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await listLocations({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

locationsRoute.get(
	"/:id",
	describeRoute({
		tags: ["Locations"],
		summary: "Get a merchant location",
		responses: { 200: jsonResponse("Location.", Location), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getLocation(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "location_not_found" }, 404);
		return c.json(r);
	},
);

locationsRoute.put(
	"/:id",
	describeRoute({
		tags: ["Locations"],
		summary: "Create or replace a merchant location",
		responses: { 201: jsonResponse("Created.", Location), ...COMMON },
	}),
	requireApiKey,
	tbBody(LocationCreate),
	async (c) => {
		const r = await createLocation(c.req.param("id"), c.req.valid("json"), { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "location_create_failed" }, 502);
		return c.json(r, 201);
	},
);

locationsRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Locations"],
		summary: "Delete a merchant location",
		responses: { 204: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deleteLocation(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		return c.body(null, 204);
	},
);

locationsRoute.post(
	"/:id/enable",
	describeRoute({
		tags: ["Locations"],
		summary: "Enable a location",
		responses: { 200: jsonResponse("Updated.", Location), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await setLocationStatus(c.req.param("id"), true, { apiKeyId: c.var.apiKey.id });
		return r ? c.json(r) : c.json({ error: "location_not_found" }, 404);
	},
);

locationsRoute.post(
	"/:id/disable",
	describeRoute({
		tags: ["Locations"],
		summary: "Disable a location",
		responses: { 200: jsonResponse("Updated.", Location), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await setLocationStatus(c.req.param("id"), false, { apiKeyId: c.var.apiKey.id });
		return r ? c.json(r) : c.json({ error: "location_not_found" }, 404);
	},
);
