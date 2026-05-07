/**
 * `/v1/recommendations` — sell/recommendation, normalized.
 */

import { RecommendationsListQuery, RecommendationsListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { listRecommendations } from "../../services/recommendations.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const recommendationsRoute = new Hono();

recommendationsRoute.get(
	"/",
	describeRoute({
		tags: ["Recommendations"],
		summary: "List listing optimization recommendations",
		parameters: paramsFor("query", RecommendationsListQuery),
		responses: {
			200: jsonResponse("Recommendations.", RecommendationsListResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbCoerce("query", RecommendationsListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listRecommendations(q, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({
			recommendations: r.recommendations,
			limit: r.limit,
			offset: r.offset,
			...(r.total !== undefined ? { total: r.total } : {}),
		} satisfies RecommendationsListResponse);
	},
);
