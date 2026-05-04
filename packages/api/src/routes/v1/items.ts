/**
 * `/v1/items/*` — flipagent-native marketplace listings surface.
 *
 *   GET /v1/items/search    active or sold (?status=, default active)
 *   GET /v1/items/{id}      single listing (?status= to read sold)
 *
 * Wraps the `services/search.ts` + `services/items/detail` dispatchers,
 * runs cents-int conversion + eBay-filter composition at the
 * boundary, and returns the normalized `Item` / `ItemSearchResponse`
 * shapes from `@flipagent/types`.
 */

import {
	CompatibilityCheckRequest,
	CompatibilityCheckResponse,
	ItemDetailQuery,
	ItemDetailResponse,
	ItemSearchByImageRequest,
	ItemSearchQuery,
	ItemSearchResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { checkCompatibility } from "../../services/compatibility.js";
import { getItemDetail } from "../../services/items/detail.js";
import { ListingsError } from "../../services/items/errors.js";
import { ebayMarketplaceForCountry, mapItemSearchQuery } from "../../services/items/query.js";
import { searchItemsByImage } from "../../services/items/search-by-image.js";
import { ebayItemToFlipagent } from "../../services/items/transform.js";
import { search } from "../../services/search.js";
import { renderResultHeaders } from "../../services/shared/headers.js";
import { parseItemId } from "../../utils/item-id.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const itemsRoute = new Hono();

itemsRoute.post(
	"/check-compatibility",
	describeRoute({
		tags: ["Items"],
		summary: "Check parts/motors compatibility for an item",
		responses: {
			200: jsonResponse("Compatibility.", CompatibilityCheckResponse),
			401: errorResponse("Auth missing."),
			502: errorResponse("Upstream eBay failed."),
		},
	}),
	requireApiKey,
	tbBody(CompatibilityCheckRequest),
	async (c) => c.json({ ...(await checkCompatibility(c.req.valid("json"))), source: "rest" as const }),
);

itemsRoute.post(
	"/search-by-image",
	describeRoute({
		tags: ["Items"],
		summary: "Image-based item search",
		description:
			"Wraps Buy Browse `search_by_image`. Body carries a base64-encoded image; response is the same `ItemSearchResponse` as keyword `/search`.",
		responses: {
			200: jsonResponse("Items.", ItemSearchResponse),
			401: errorResponse("Auth missing."),
			502: errorResponse("Upstream eBay failed."),
		},
	}),
	requireApiKey,
	tbBody(ItemSearchByImageRequest),
	async (c) => c.json(await searchItemsByImage(c.req.valid("json"))),
);

itemsRoute.get(
	"/search",
	describeRoute({
		tags: ["Items"],
		summary: "Search marketplace listings (active or sold)",
		description:
			"Unified across active (eBay Browse) and sold (Marketplace Insights). Pass `status=active` (default) or `status=sold`. Response is the normalized flipagent `ItemSearchResponse` — cents-int Money, ISO timestamps, `marketplace` on every record.",
		parameters: paramsFor("query", ItemSearchQuery),
		responses: {
			200: jsonResponse("Items page.", ItemSearchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream marketplace or bridge transport failed."),
			503: errorResponse("Required source not configured (e.g. status=sold without EBAY_INSIGHTS_APPROVED)."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ItemSearchQuery),
	async (c) => {
		const query = c.req.valid("query");
		// eBay Browse rule: must carry at least one of q / category_ids /
		// gtin / epid. Empty searches return either an unhelpful error
		// upstream or an arbitrary popularity feed; surface the requirement
		// here with a friendly message instead.
		if (!query.q?.trim() && !query.categoryId && !query.gtin && !query.epid) {
			return c.json(
				{
					error: "missing_query",
					message:
						"Provide at least one of: q (keyword), categoryId, gtin, or epid. Category-only browse is supported — pass categoryId on its own.",
				},
				400,
			);
		}
		const mapped = mapItemSearchQuery(query);
		try {
			const result = await search(
				{
					q: mapped.q,
					mode: query.status === "sold" ? "sold" : "active",
					limit: mapped.limit,
					offset: mapped.offset,
					filter: mapped.filter,
					sort: mapped.sort,
					categoryIds: mapped.categoryIds,
					aspectFilter: mapped.aspectFilter,
					fieldgroups: mapped.fieldgroups,
					autoCorrect: mapped.autoCorrect,
					compatibilityFilter: mapped.compatibilityFilter,
					charityIds: mapped.charityIds,
					epid: query.epid,
					gtin: query.gtin,
				},
				{
					apiKey: c.var.apiKey,
					marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID") ?? ebayMarketplaceForCountry(query.country),
					acceptLanguage: c.req.header("Accept-Language"),
				},
			);
			renderResultHeaders(c, result);
			const ebayItems = [...(result.body.itemSummaries ?? []), ...(result.body.itemSales ?? [])];
			const items = ebayItems.map(ebayItemToFlipagent);
			const body: ItemSearchResponse = {
				items,
				limit: result.body.limit ?? query.limit ?? 50,
				offset: result.body.offset ?? query.offset ?? 0,
				...(result.body.total !== undefined ? { total: result.body.total } : {}),
				source: result.fromCache
					? (`cache:${result.source}` as ItemSearchResponse["source"])
					: (result.source as ItemSearchResponse["source"]),
			};
			return c.json(body);
		} catch (err) {
			if (err instanceof ListingsError) {
				const errorBody = err.body ?? { error: err.code, message: err.message };
				return c.json(
					errorBody as { error: string; message: string },
					err.status as 400 | 404 | 412 | 502 | 503 | 504,
				);
			}
			throw err;
		}
	},
);

itemsRoute.get(
	"/:id",
	describeRoute({
		tags: ["Items"],
		summary: "Get a single listing by id",
		description:
			"Accepts any id form: bare numeric (`123456789012`), eBay v1 (`v1|123|0`), or full `ebay.com/itm/...` URL. Returns the normalized `Item`. Pass `?status=sold` to read a sold listing.",
		parameters: [
			{ in: "path", name: "id", required: true, schema: { type: "string" } },
			...paramsFor("query", ItemDetailQuery),
		],
		responses: {
			200: jsonResponse("Item.", ItemDetailResponse),
			400: errorResponse("Invalid id format."),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Listing not found."),
			502: errorResponse("Upstream marketplace failed."),
			503: errorResponse("Required source not configured."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ItemDetailQuery),
	async (c) => {
		const idParam = c.req.param("id");
		const parsed = parseItemId(idParam);
		if (!parsed) {
			return c.json({ error: "invalid_item_id", message: `Could not parse '${idParam}' as an eBay item id.` }, 400);
		}
		try {
			const result = await getItemDetail(parsed.legacyId, {
				apiKey: c.var.apiKey,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
				acceptLanguage: c.req.header("Accept-Language"),
				variationId: parsed.variationId,
			});
			if (!result) {
				return c.json({ error: "item_not_found", message: `No listing for id '${parsed.legacyId}'.` }, 404);
			}
			renderResultHeaders(c, result);
			const item = ebayItemToFlipagent(result.body);
			const body: ItemDetailResponse = {
				...item,
				source: result.fromCache
					? (`cache:${result.source}` as ItemDetailResponse["source"])
					: (result.source as ItemDetailResponse["source"]),
			};
			return c.json(body);
		} catch (err) {
			if (err instanceof ListingsError) {
				const errorBody = err.body ?? { error: err.code, message: err.message };
				return c.json(
					errorBody as { error: string; message: string },
					err.status as 400 | 404 | 412 | 502 | 503 | 504,
				);
			}
			throw err;
		}
	},
);
