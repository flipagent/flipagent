/**
 * `/v1/trends/*` — cross-user demand trends. Hosted-only value: aggregates
 * query-pulse + observation data into category-level heat / trend signals
 * that self-host instances can't compute (no cross-user data).
 *
 *   GET /v1/trends/categories    — categories with current-hour query
 *                                  spike vs prior-week baseline
 */

import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { topTrendingCategories } from "../../services/trends.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const trendsRoute = new Hono();

const TrendingCategory = Type.Object(
	{
		categoryId: Type.String(),
		currentHourCount: Type.Integer(),
		weeklyBaselineHourly: Type.Number(),
		zScore: Type.Number(),
		asOf: Type.String({ format: "date-time" }),
	},
	{ $id: "TrendingCategory" },
);

const TrendingResponse = Type.Object({ trending: Type.Array(TrendingCategory) }, { $id: "TrendingResponse" });

trendsRoute.get(
	"/categories",
	describeRoute({
		tags: ["Trends"],
		summary: "Categories whose query frequency is spiking now",
		description:
			"Hosted-only feed. Cross-user query pulse over the last hour, scored against the prior-7-day per-hour baseline. Use it to surface 'hot' categories on the dashboard or to feed a Discover preset. Returns the top 10 by Poisson z-score; positive scores indicate a fresh demand spike. Empty when no observations are accumulating (e.g. on self-host or fresh deploy).",
		responses: {
			200: jsonResponse("Top trending categories.", TrendingResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const trending = await topTrendingCategories(10);
		return c.json({ trending });
	},
);
