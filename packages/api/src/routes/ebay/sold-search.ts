/**
 * GET /buy/marketplace_insights/v1_beta/item_sales/search
 *
 * eBay-compatible. Returns `itemSales[]` (Marketplace Insights field name).
 * Same envelope shape as the active-listing search.
 *
 * Transport selected by `EBAY_SOLD_SOURCE` (rest | scrape | bridge) — explicit
 * per-request, no fallback. REST path requires `EBAY_INSIGHTS_APPROVED=1`;
 * without that flag, `EBAY_SOLD_SOURCE=rest` returns 503 even though the
 * route is mounted (the upstream API is gated by eBay tenant approval).
 */

import { BrowseSearchResponse, type BrowseSearchSource, SoldSearchQuery } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getAppAccessToken } from "../../auth/ebay-oauth.js";
import { config, isInsightsApproved } from "../../config.js";
import { requireApiKey } from "../../middleware/auth.js";
import { getCached, hashQuery, setCached } from "../../proxy/cache.js";
import { scrapeSearch } from "../../proxy/scrape.js";
import { BridgeError, bridgeSoldSearch } from "../../services/listings/bridge.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const ebaySoldSearchRoute = new Hono();

const SOLD_TTL_SEC = 60 * 60 * 12; // 12h — sold prices don't change

/**
 * Pull the conditionIds list out of a Browse-style filter expression
 * (`...,conditionIds:{1000|3000},...`) so the scrape path can translate
 * it into eBay's web `LH_ItemCondition=1000|3000` parameter. Returns
 * undefined if the filter doesn't carry conditionIds.
 */
function parseConditionIdsFilter(filter: string | undefined): string[] | undefined {
	if (!filter) return undefined;
	const m = filter.match(/conditionIds:\{([^}]+)\}/);
	if (!m) return undefined;
	const ids = m[1]!
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);
	return ids.length > 0 ? ids : undefined;
}

async function fetchInsightsRest(args: { q: string; filter?: string; limit: number }): Promise<BrowseSearchResponse> {
	const token = await getAppAccessToken();
	const params = new URLSearchParams({ q: args.q, limit: String(args.limit) });
	if (args.filter) params.set("filter", args.filter);
	const url = `${config.EBAY_BASE_URL}/buy/marketplace_insights/v1_beta/item_sales/search?${params}`;
	const res = await fetchRetry(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			"X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`marketplace_insights ${res.status}: ${(await res.text()).slice(0, 200)}`);
	}
	return (await res.json()) as BrowseSearchResponse;
}

ebaySoldSearchRoute.get(
	"/",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Recently-sold listings",
		description:
			"Mirror of Marketplace Insights `item_sales/search`. Transport selected via `EBAY_SOLD_SOURCE` (rest | scrape | bridge). REST path requires `EBAY_INSIGHTS_APPROVED=1`; otherwise returns 503.",
		parameters: paramsFor("query", SoldSearchQuery),
		responses: {
			200: jsonResponse("Marketplace Insights envelope.", BrowseSearchResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			412: errorResponse("Configured source unavailable (e.g. bridge not paired)."),
			429: errorResponse("Tier monthly limit reached."),
			502: errorResponse("Upstream eBay or bridge transport failed."),
			503: errorResponse("EBAY_SOLD_SOURCE not configured (or rest selected without Insights approval)."),
		},
	}),
	requireApiKey,
	tbCoerce("query", SoldSearchQuery),
	async (c) => {
		const source = config.EBAY_SOLD_SOURCE;
		if (!source) {
			return c.json(
				{ error: "not_configured", message: "EBAY_SOLD_SOURCE must be one of: rest, scrape, bridge" },
				503,
			);
		}
		if (source === "rest" && !isInsightsApproved()) {
			return c.json(
				{
					error: "not_configured",
					message: "EBAY_SOLD_SOURCE=rest requires EBAY_INSIGHTS_APPROVED=1 (eBay tenant approval).",
				},
				503,
			);
		}

		const query = c.req.valid("query");
		const { q, filter, limit = 50 } = query;
		const path = "/buy/marketplace_insights/v1_beta/item_sales/search";
		const queryHash = hashQuery({ q, filter, limit, soldOnly: true });

		const cached = await getCached<BrowseSearchResponse>(path, queryHash).catch(() => null);
		if (cached) {
			const cacheSource: BrowseSearchSource =
				cached.source === "rest" ? "cache:rest" : cached.source === "bridge" ? "cache:bridge" : "cache:scrape";
			c.header("X-Flipagent-Source", cacheSource);
			c.header("X-Flipagent-Cached-At", cached.createdAt.toISOString());
			return c.json({ ...cached.body, source: cacheSource });
		}

		if (source === "rest") {
			let body: BrowseSearchResponse;
			try {
				body = await fetchInsightsRest({ q, filter, limit });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: "upstream_failed" as const, message }, 502);
			}
			await setCached(path, queryHash, body, "rest", SOLD_TTL_SEC).catch((err) =>
				console.error("[sold-search] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "rest");
			return c.json({ ...body, source: "rest" as const });
		}

		if (source === "scrape") {
			let body: BrowseSearchResponse;
			try {
				body = await scrapeSearch({
					q,
					soldOnly: true,
					limit,
					conditionIds: parseConditionIdsFilter(filter),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: "upstream_failed" as const, message }, 502);
			}
			await setCached(path, queryHash, body, "scrape", SOLD_TTL_SEC).catch((err) =>
				console.error("[sold-search] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "scrape");
			return c.json({ ...body, source: "scrape" as const });
		}

		// source === "bridge"
		try {
			const body = await bridgeSoldSearch(c.var.apiKey, query);
			await setCached(path, queryHash, body, "bridge", SOLD_TTL_SEC).catch((err) =>
				console.error("[sold-search] cache set failed:", err),
			);
			c.header("X-Flipagent-Source", "bridge");
			return c.json({ ...body, source: "bridge" as const });
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
