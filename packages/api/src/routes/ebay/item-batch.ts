/**
 * GET /buy/browse/v1/item/get_items
 * GET /buy/browse/v1/item/get_items_by_item_group
 *
 * eBay-compatible batch detail endpoints. Browse Buy uses an app-credential
 * token (no user OAuth needed) — these passthrough straight to api.ebay.com.
 * The single-id `/item/{itemId}` route is still scraper-backed for the
 * anonymous-read tier; these batch variants require EBAY_CLIENT_ID.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughApp } from "../../proxy/ebay-passthrough.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebayItemBatchRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("Missing or invalid API key."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("eBay OAuth env not configured."),
};

ebayItemBatchRoute.get(
	"/get_items",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Batch item detail (by itemId)",
		description: "Mirror of Browse `getItems`. Accepts `?item_ids=…,…`. Returns up to 20 items per call.",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);

ebayItemBatchRoute.get(
	"/get_items_by_item_group",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Item group (variations) detail",
		description: "Mirror of Browse `getItemsByItemGroup`. Returns all variation children for a given group id.",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);
