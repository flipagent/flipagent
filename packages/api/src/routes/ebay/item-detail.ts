/**
 * GET /buy/browse/v1/item/{itemId}
 *
 * eBay-compatible. Returns `ItemDetail` shape. Transport selected by
 * `EBAY_DETAIL_SOURCE` env (rest | scrape | bridge) — explicit, no fallback.
 *
 * REST path note: we hit eBay's `/item/get_item_by_legacy_id?legacy_item_id=<n>`
 * (not `/item/<v1|...|0>`). The latter rejects multi-variation parent
 * listings — sneakers / bags / clothes — with 11001 because eBay can't
 * pick which variation to return; the legacy-id endpoint resolves a
 * default variation server-side. Single-SKU items work either way.
 */

import { ItemDetail, ItemDetailParams } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getAppAccessToken } from "../../auth/ebay-oauth.js";
import { config, isEbayOAuthConfigured } from "../../config.js";
import { requireApiKey } from "../../middleware/auth.js";
import { getCached, hashQuery, setCached } from "../../proxy/cache.js";
import { scrapeItemDetail } from "../../proxy/scrape.js";
import { BridgeError, bridgeItemDetail } from "../../services/listings/bridge.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const ebayItemDetailRoute = new Hono();

const ITEM_DETAIL_TTL_SEC = 60 * 60 * 4; // 4h — detail pages don't change often

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

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
			if (!isEbayOAuthConfigured()) {
				return c.json({ error: "ebay_not_configured" as const, message: "EBAY_CLIENT_ID/SECRET not set." }, 503);
			}
			const legacyId = itemId.replace(/^v1\|/, "").replace(/\|0$/, "");
			if (!/^\d{6,}$/.test(legacyId)) {
				return c.json({ error: "invalid_item_id" as const, message: `itemId ${itemId} is malformed.` }, 400);
			}
			let body: ItemDetail;
			let upstreamStatus: number;
			try {
				const token = await getAppAccessToken();
				const url = `${config.EBAY_BASE_URL}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyId}`;
				const upstream = await fetchRetry(url, {
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
						"X-EBAY-C-MARKETPLACE-ID": c.req.header("X-EBAY-C-MARKETPLACE-ID") ?? "EBAY_US",
					},
				});
				upstreamStatus = upstream.status;
				const text = await upstream.text();
				if (!upstream.ok) {
					const parsed = safeJson(text);
					return c.json(parsed ?? { raw: text }, upstream.status as 400 | 404 | 502);
				}
				body = JSON.parse(text) as ItemDetail;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: "upstream_failed" as const, message }, 502);
			}
			await setCached(path, queryHash, body, "rest", ITEM_DETAIL_TTL_SEC).catch((err) =>
				console.error("[item-detail] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "rest");
			void upstreamStatus;
			return c.json(body);
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
