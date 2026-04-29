/**
 * GET /buy/browse/v1/item/{itemId}
 *
 * eBay-compatible. Returns `ItemDetail` shape. Transport selected by
 * `EBAY_DETAIL_SOURCE` env (rest | scrape | bridge) — explicit, no
 * fallback.
 *
 * REST path note: the listings/detail service hits eBay's
 * `/item/get_item_by_legacy_id?legacy_item_id=<n>` (not
 * `/item/<v1|...|0>`). The latter rejects multi-variation parent
 * listings — sneakers / bags / clothes — with 11001 because eBay
 * can't pick which variation to return; the legacy-id endpoint
 * resolves a default variation server-side.
 *
 * Route is paper-thin — id validation + headers — everything else
 * (cache, observation archive) lives in `services/listings/detail.ts`.
 */

import { ItemDetail, ItemDetailParams } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../../middleware/auth.js";
import { getItemDetail } from "../../../services/listings/detail.js";
import { ListingsError } from "../../../services/listings/errors.js";
import { renderResultHeaders } from "../../../services/shared/headers.js";
import { legacyFromV1 } from "../../../utils/item-id.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../../utils/openapi.js";

export const ebayItemDetailRoute = new Hono();

ebayItemDetailRoute.get(
	"/:itemId",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Item detail",
		parameters: paramsFor("path", ItemDetailParams),
		responses: {
			200: jsonResponse("ItemDetail.", ItemDetail),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Listing not found or removed."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream eBay or bridge transport failed."),
			503: errorResponse("EBAY_DETAIL_SOURCE not configured."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ItemDetailParams),
	async (c) => {
		const { itemId } = c.req.valid("param");
		const legacyId = legacyFromV1(itemId);
		if (!legacyId || !/^\d{6,}$/.test(legacyId)) {
			return c.json({ error: "invalid_item_id" as const, message: `itemId ${itemId} is malformed.` }, 400);
		}
		try {
			const result = await getItemDetail(legacyId, {
				apiKey: c.var.apiKey,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
				acceptLanguage: c.req.header("Accept-Language"),
			});
			if (!result) {
				return c.json({ error: "not_found" as const, message: `itemId ${itemId} not found.` }, 404);
			}
			renderResultHeaders(c, result);
			return c.json(result.body);
		} catch (err) {
			if (err instanceof ListingsError) {
				const body = err.body ?? { error: err.code, message: err.message };
				return c.json(body as { error: string; message: string }, err.status as 400 | 404 | 412 | 502 | 503 | 504);
			}
			throw err;
		}
	},
);
