/**
 * GET /buy/browse/v1/item_summary/search
 *
 * eBay-compatible. Returns the same `SearchPagedCollection` envelope eBay's
 * Browse API returns — `itemSummaries[]`, `total`, etc. Caller can point
 * any eBay SDK at api.flipagent.dev and have it work transparently.
 *
 * The transport (Browse REST / scrape / bridge) is picked explicitly via
 * the `EBAY_LISTINGS_SOURCE` env. No silent fallback — if the configured
 * primitive is unavailable (REST quota exhausted, bridge unpaired, etc.)
 * the route surfaces the error rather than burning a different budget.
 */

import { BrowseSearchQuery, BrowseSearchResponse } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config } from "../../config.js";
import { requireApiKey } from "../../middleware/auth.js";
import { getCached, hashQuery, setCached } from "../../proxy/cache.js";
import { ebayPassthroughApp } from "../../proxy/ebay-passthrough.js";
import { scrapeSearch } from "../../proxy/scrape.js";
import { BridgeError, bridgeListingsSearch } from "../../services/listings/bridge.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const ebaySearchRoute = new Hono();

const sortMap: Record<
	string,
	"endingSoonest" | "newlyListed" | "pricePlusShippingLowest" | "pricePlusShippingHighest"
> = {
	endingSoonest: "endingSoonest",
	newlyListed: "newlyListed",
	"price asc": "pricePlusShippingLowest",
	"price desc": "pricePlusShippingHighest",
};

ebaySearchRoute.get(
	"/",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Search active listings",
		description:
			"Mirror of eBay's Browse `item_summary/search`. Returns the same `SearchPagedCollection` envelope with `itemSummaries[]`. Transport is selected via `EBAY_LISTINGS_SOURCE` (rest | scrape | bridge); the response shape is identical regardless.",
		parameters: paramsFor("query", BrowseSearchQuery),
		responses: {
			200: jsonResponse("SearchPagedCollection envelope.", BrowseSearchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream eBay or bridge transport failed."),
			503: errorResponse("EBAY_LISTINGS_SOURCE not configured."),
		},
	}),
	requireApiKey,
	tbCoerce("query", BrowseSearchQuery),
	async (c) => {
		const source = config.EBAY_LISTINGS_SOURCE;
		if (!source) {
			return c.json(
				{ error: "not_configured", message: "EBAY_LISTINGS_SOURCE must be one of: rest, scrape, bridge" },
				503,
			);
		}

		const query = c.req.valid("query");
		const { q, filter, sort, limit = 25 } = query;
		const path = "/buy/browse/v1/item_summary/search";
		const queryHash = hashQuery({ q, filter, sort, limit, soldOnly: false });

		// Cache lookup is source-agnostic — same shape regardless of how the
		// row was populated. The `source` column on the hit reveals origin.
		const cached = await getCached<BrowseSearchResponse>(path, queryHash).catch(() => null);
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
			const auctionOnly = filter?.includes("buyingOptions:{AUCTION}") ?? false;
			const binOnly = filter?.includes("buyingOptions:{FIXED_PRICE}") ?? false;
			let body: BrowseSearchResponse;
			try {
				body = await scrapeSearch({
					q,
					auctionOnly,
					binOnly,
					sort: sort ? sortMap[sort] : undefined,
					limit,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: "upstream_failed" as const, message }, 502);
			}
			await setCached(path, queryHash, body, "scrape").catch((err) =>
				console.error("[search] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "scrape");
			return c.json(body);
		}

		// source === "bridge"
		try {
			const body = await bridgeListingsSearch(c.var.apiKey, query);
			await setCached(path, queryHash, body, "bridge").catch((err) =>
				console.error("[search] cache set failed:", err),
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
