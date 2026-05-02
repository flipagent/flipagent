/**
 * `/v1/marketplaces/{country}` — per-marketplace metadata + digital-signature routes.
 */

import { type DigitalSignatureRoutesResponse, MarketplaceMetadata } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getDigitalSignatureRoutes } from "../../services/marketplace-meta/digital-signature.js";
import { getMarketplaceMetadata } from "../../services/marketplace-meta/operations.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const marketplacesRoute = new Hono();

marketplacesRoute.get(
	"/:country/digital-signature",
	describeRoute({
		tags: ["Marketplaces"],
		summary: "Routes that require digital-signature delivery",
		responses: { 200: { description: "Routes." }, 401: errorResponse("Auth missing.") },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getDigitalSignatureRoutes(c.req.param("country"), c.var.apiKey.id)),
			source: "rest" as const,
		} satisfies DigitalSignatureRoutesResponse),
);

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
		return c.json({ ...meta, source: "rest" as const });
	},
);
