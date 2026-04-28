/**
 * GET /buy/browse/v1/item/{itemId}
 *
 * eBay-compatible. Returns `ItemDetail` shape. Transport selected by
 * `EBAY_DETAIL_SOURCE` env (rest | scrape | bridge) — explicit, no fallback.
 */

import { ItemDetail, ItemDetailParams } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config } from "../../config.js";
import { requireApiKey } from "../../middleware/auth.js";
import { getCached, hashQuery, setCached } from "../../proxy/cache.js";
import { ebayPassthroughApp } from "../../proxy/ebay-passthrough.js";
import { scrapeItemDetail } from "../../proxy/scrape.js";
import { BridgeError, bridgeItemDetail } from "../../services/listings/bridge.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const ebayItemDetailRoute = new Hono();

const ITEM_DETAIL_TTL_SEC = 60 * 60 * 4; // 4h — detail pages don't change often

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
		const source = config.EBAY_DETAIL_SOURCE;
		if (!source) {
			return c.json(
				{ error: "not_configured", message: "EBAY_DETAIL_SOURCE must be one of: rest, scrape, bridge" },
				503,
			);
		}

		const { itemId } = c.req.valid("param");
		const path = "/buy/browse/v1/item";
		const queryHash = hashQuery({ itemId });

		const cached = await getCached<ItemDetail>(path, queryHash).catch(() => null);
		if (cached) {
			c.header("X-Flipagent-Source", `cache:${cached.source}`);
			c.header("X-Flipagent-Cached-At", cached.createdAt.toISOString());
			return c.json(cached.body);
		}

		if (source === "rest") {
			c.header("X-Flipagent-Source", "rest");
			return ebayPassthroughApp(c);
		}

		if (source === "scrape") {
			let body: ItemDetail | null;
			try {
				body = await scrapeItemDetail(itemId);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: "upstream_failed" as const, message }, 502);
			}
			if (!body) {
				return c.json({ error: "not_found" as const, message: `itemId ${itemId} not found.` }, 404);
			}
			await setCached(path, queryHash, body, "scrape", ITEM_DETAIL_TTL_SEC).catch((err) =>
				console.error("[item-detail] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "scrape");
			return c.json(body);
		}

		// source === "bridge"
		try {
			const body = await bridgeItemDetail(c.var.apiKey, itemId);
			if (!body) {
				return c.json({ error: "not_found" as const, message: `itemId ${itemId} not found.` }, 404);
			}
			await setCached(path, queryHash, body, "bridge", ITEM_DETAIL_TTL_SEC).catch((err) =>
				console.error("[item-detail] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "bridge");
			return c.json(body);
		} catch (err) {
			if (err instanceof BridgeError) {
				const status = err.code === "bridge_not_paired" ? 412 : err.code === "bridge_timeout" ? 504 : 502;
				return c.json({ error: err.code, message: err.message }, status);
			}
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: "bridge_failed" as const, message }, 502);
		}
	},
);
