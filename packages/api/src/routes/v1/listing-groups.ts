/**
 * `/v1/listing-groups/*` — multi-variation parent groups.
 */

import { ListingGroup, ListingGroupUpsert } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { deleteListingGroup, getListingGroup, upsertListingGroup } from "../../services/listings/bulk.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const listingGroupsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

listingGroupsRoute.put(
	"/:id",
	describeRoute({
		tags: ["ListingGroups"],
		summary: "Create or replace a multi-variation parent group",
		responses: { 200: jsonResponse("Group.", ListingGroup), ...COMMON },
	}),
	requireApiKey,
	tbBody(ListingGroupUpsert),
	async (c) => {
		const id = c.req.param("id");
		const r = await upsertListingGroup(id, c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!r) return c.json({ error: "group_not_found" }, 404);
		return c.json({ ...r });
	},
);

listingGroupsRoute.get(
	"/:id",
	describeRoute({
		tags: ["ListingGroups"],
		summary: "Get a multi-variation parent group",
		responses: { 200: jsonResponse("Group.", ListingGroup), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getListingGroup(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!r) return c.json({ error: "group_not_found" }, 404);
		return c.json({ ...r });
	},
);

listingGroupsRoute.delete(
	"/:id",
	describeRoute({
		tags: ["ListingGroups"],
		summary: "Delete a multi-variation parent group",
		responses: { 204: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deleteListingGroup(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.body(null, 204);
	},
);
