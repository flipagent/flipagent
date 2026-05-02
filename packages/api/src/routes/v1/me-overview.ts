/**
 * `/v1/me/{selling,buying}` — caller's seller-side & buyer-side overviews
 * (Trading XML GetMyeBaySelling / GetMyeBayBuying).
 *
 * Lives in its own route because the underlying transport is Trading XML
 * with `withTradingAuth`, while the rest of `/me` is session-cookie auth
 * (dashboard) or API-key auth (seller account).
 */

import { BuyingOverview, SellingOverview } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { fetchBuyingOverview, fetchSellingOverview } from "../../services/me-overview.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const meOverviewRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Trading API failed.") };

meOverviewRoute.get(
	"/selling",
	describeRoute({
		tags: ["Me"],
		summary: "Active + sold + unsold + scheduled listings (Trading GetMyeBaySelling)",
		responses: { 200: jsonResponse("Selling overview.", SellingOverview), ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) =>
		c.json({ ...(await fetchSellingOverview(accessToken)), source: "trading" as const }),
	),
);

meOverviewRoute.get(
	"/buying",
	describeRoute({
		tags: ["Me"],
		summary: "Bidding + watching + won + lost (Trading GetMyeBayBuying)",
		responses: { 200: jsonResponse("Buying overview.", BuyingOverview), ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) =>
		c.json({ ...(await fetchBuyingOverview(accessToken)), source: "trading" as const }),
	),
);
