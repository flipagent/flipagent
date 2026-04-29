/**
 * eBay Commerce Taxonomy API mirror. Read-side, app-credential token (no
 * user OAuth needed), so this proxies as soon as EBAY_CLIENT_ID is configured.
 *
 *   GET /commerce/taxonomy/v1/get_default_category_tree_id
 *   GET /commerce/taxonomy/v1/category_tree/{categoryTreeId}
 *   GET /commerce/taxonomy/v1/category_tree/{categoryTreeId}/get_item_aspects_for_category
 *   GET /commerce/taxonomy/v1/category_tree/{categoryTreeId}/get_category_subtree
 *
 * Cache-first wrapped: Taxonomy data changes monthly at most, so each
 * unique (path, query) combo is fetched live exactly once and served
 * from `proxy_response_cache` for ~30 days afterward. This dodges the
 * shared per-app daily call cap (5K/day default) — see
 * `packages/api/src/middleware/cache-first.ts`.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { cacheFirst } from "../../../middleware/cache-first.js";
import { ebayPassthroughApp } from "../../../services/ebay/rest/client.js";
import { errorResponse } from "../../../utils/openapi.js";

export const ebayCommerceTaxonomyRoute = new Hono();

// Cache windows tuned for typical churn:
//   - default tree id: ~never changes per marketplace.
//   - whole tree: eBay republishes monthly-ish.
//   - aspects per category: changes when eBay tweaks listing forms,
//     also monthly cadence.
//   - subtree: same as full tree.
//   - suggestions (typed query): far more dynamic, so we DO NOT cache
//     by default — keep it pass-through.
const TTL_TREE_SEC = 30 * 24 * 60 * 60; // 30 days
const TTL_ASPECTS_SEC = 14 * 24 * 60 * 60; // 14 days
const TTL_DEFAULT_ID_SEC = 90 * 24 * 60 * 60; // 90 days

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com (or served from cache)." },
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
	cacheFirst({ scope: "taxonomy:default_id", ttlSeconds: TTL_DEFAULT_ID_SEC }),
	ebayPassthroughApp,
);

ebayCommerceTaxonomyRoute.get(
	"/category_tree/:categoryTreeId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get the full category tree",
		responses: passthroughResponses,
	}),
	cacheFirst({ scope: "taxonomy:tree", ttlSeconds: TTL_TREE_SEC }),
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
	cacheFirst({ scope: "taxonomy:aspects", ttlSeconds: TTL_ASPECTS_SEC }),
	ebayPassthroughApp,
);

ebayCommerceTaxonomyRoute.get(
	"/category_tree/:categoryTreeId/get_category_subtree",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get a subtree of categories",
		responses: passthroughResponses,
	}),
	cacheFirst({ scope: "taxonomy:subtree", ttlSeconds: TTL_TREE_SEC }),
	ebayPassthroughApp,
);

// `get_category_suggestions` is intentionally NOT cached — it's
// a per-typed-query lookup and the cache hit ratio would be near zero
// while the storage churn would be high.
ebayCommerceTaxonomyRoute.get(
	"/category_tree/:categoryTreeId/get_category_suggestions",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Get category suggestions for a typed query (uncached — pass-through)",
		responses: passthroughResponses,
	}),
	ebayPassthroughApp,
);
