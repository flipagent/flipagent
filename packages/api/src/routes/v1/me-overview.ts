/**
 * `/v1/me/{selling,buying,quota,programs}` — caller-side reads.
 *
 * `selling` / `buying` use Trading XML; `quota` / `programs` use REST.
 * Lives in its own route because of mixed transports + because the
 * rest of `/me` is session-cookie auth (dashboard) — these are
 * API-key auth (seller account).
 */

import {
	BuyingOverview,
	MeProgramsResponse,
	MeQuotaResponse,
	ProgramOptRequest,
	ProgramOptResponse,
	SellingOverview,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { getMeQuota, getOptedInPrograms, optInToProgram, optOutOfProgram } from "../../services/me-account.js";
import { fetchBuyingOverview, fetchSellingOverview } from "../../services/me-overview.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

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
	withTradingAuth(async (c, accessToken) => c.json({ ...(await fetchSellingOverview(accessToken)) })),
);

meOverviewRoute.get(
	"/buying",
	describeRoute({
		tags: ["Me"],
		summary: "Bidding + watching + won + lost (Trading GetMyeBayBuying)",
		responses: { 200: jsonResponse("Buying overview.", BuyingOverview), ...COMMON },
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => c.json({ ...(await fetchBuyingOverview(accessToken)) })),
);

meOverviewRoute.get(
	"/quota",
	describeRoute({
		tags: ["Me"],
		summary: "API rate-limit budget (Developer Analytics)",
		description:
			"Combines `/developer/analytics/v1_beta/rate_limit` (app-wide) and `/user_rate_limit` (per-user). Useful for agents to know how much budget they have left in the current window before bursting.",
		responses: { 200: jsonResponse("Quota.", MeQuotaResponse), 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getMeQuota(c.var.apiKey.id)) }),
);

meOverviewRoute.get(
	"/programs",
	describeRoute({
		tags: ["Me"],
		summary: "List seller programs the caller is opted in to",
		responses: { 200: jsonResponse("Programs.", MeProgramsResponse), 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getOptedInPrograms(c.var.apiKey.id)) }),
);

meOverviewRoute.post(
	"/programs/opt-in",
	describeRoute({
		tags: ["Me"],
		summary: "Opt in to a seller program (managed payments, etc.)",
		responses: { 200: jsonResponse("Acknowledged.", ProgramOptResponse), 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	tbBody(ProgramOptRequest),
	async (c) => {
		const body = c.req.valid("json");
		return c.json({ ...(await optInToProgram(c.var.apiKey.id, body.programType)) });
	},
);

meOverviewRoute.post(
	"/programs/opt-out",
	describeRoute({
		tags: ["Me"],
		summary: "Opt out of a seller program",
		responses: { 200: jsonResponse("Acknowledged.", ProgramOptResponse), 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	tbBody(ProgramOptRequest),
	async (c) => {
		const body = c.req.valid("json");
		return c.json({ ...(await optOutOfProgram(c.var.apiKey.id, body.programType)) });
	},
);
