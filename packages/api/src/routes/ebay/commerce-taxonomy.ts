/**
 * eBay Commerce Taxonomy API mirror. Read-side, app-credential token (no
 * user OAuth needed), so this proxies as soon as EBAY_CLIENT_ID is configured.
 *
 *   GET /commerce/taxonomy/v1/get_default_category_tree_id
 *   GET /commerce/taxonomy/v1/category_tree/{categoryTreeId}
 *   GET /commerce/taxonomy/v1/category_tree/{categoryTreeId}/get_item_aspects_for_category
 *   GET /commerce/taxonomy/v1/category_tree/{categoryTreeId}/get_category_subtree
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughApp } from "../../proxy/ebay-passthrough.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebayCommerceTaxonomyRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("Missing or invalid API key."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("eBay OAuth env not configured."),
};

ebayCommerceTaxonomyRoute.get(
	"/get_default_category_tree_id",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get the default category tree id for a marketplace",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);

ebayCommerceTaxonomyRoute.get(
	"/category_tree/:categoryTreeId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get the full category tree",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);

ebayCommerceTaxonomyRoute.get(
	"/category_tree/:categoryTreeId/get_item_aspects_for_category",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get the item aspects (required + recommended) for a category",
		description: "Used when building inventory items so the listing has the right aspects.",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);

ebayCommerceTaxonomyRoute.get(
	"/category_tree/:categoryTreeId/get_category_subtree",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a subtree of categories",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);
