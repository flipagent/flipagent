/**
 * `/v1/marketplaces/{country}` — per-marketplace metadata.
 *
 * `/digital-signature` removed — wrapped a non-existent eBay endpoint
 * (`/sell/metadata/v1/marketplace/{X}/get_digital_signature_routes`
 * 404s in every variant probed; the path is also absent from eBay's
 * OpenAPI for the Sell Metadata API). Re-add only if eBay publishes
 * the endpoint or we identify the right path.
 */

import { MarketplaceMetadata } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getMarketplaceMetadata } from "../../services/marketplace-meta/operations.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const marketplacesRoute = new Hono();

marketplacesRoute.get(
	"/:country",
	describeRoute({
		tags: ["Marketplaces"],
		summary: "Get marketplace metadata (return-policy options + sales-tax jurisdictions)",
		responses: {
			200: jsonResponse("Metadata.", MarketplaceMetadata),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	async (c) => {
		const country = c.req.param("country");
		const meta = await getMarketplaceMetadata(country, { apiKeyId: c.var.apiKey.id });
		return c.json({ ...meta });
	},
);
